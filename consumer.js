const { Kafka } = require('kafkajs');
const log4js = require('log4js');

log4js.addLayout('structuredJson', () => (loggingEvent) => {
  const payload = loggingEvent.data.length === 1 && typeof loggingEvent.data[0] === 'object'
    ? loggingEvent.data[0]
    : { message: loggingEvent.data.join(' ') };

  return JSON.stringify({
    timestamp: payload.timestamp || loggingEvent.startTime.toISOString(),
    level: loggingEvent.level.levelStr,
    logger: loggingEvent.categoryName,
    ...payload,
  });
});

log4js.configure({
  appenders: {
    console: { type: 'console', layout: { type: 'structuredJson' } },
  },
  categories: {
    default: { appenders: ['console'], level: 'info' },
    cdc: { appenders: ['console'], level: 'info' },
  },
});

const cdcLogger = log4js.getLogger('cdc');

const kafka = new Kafka({
  clientId: 'helfy-cdc-consumer',
  brokers: [
    process.env.KAFKA_BROKER_1 || 'kafka-1:9092',
    process.env.KAFKA_BROKER_2 || 'kafka-2:9092',
  ],
  retry: {
    initialRetryTime: 3000,
    retries: 12,
  },
});

const consumer = kafka.consumer({ groupId: 'cdc-consumer-group' });

function normalizeCanalMessage(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { raw: parsed };
  }

  return {
    database: parsed.database,
    table: parsed.table,
    type: parsed.type,
    isDdl: parsed.isDdl,
    commitTs: parsed.ts,
    data: parsed.data,
    old: parsed.old,
    raw: parsed,
  };
}

async function waitForKafka() {
  const maxRetries = 12;
  let lastError;

  for (let i = 0; i < maxRetries; i += 1) {
    try {
      await consumer.connect();
      return;
    } catch (err) {
      lastError = err;
      console.error(`Kafka consumer connect attempt ${i + 1}/${maxRetries} failed: ${err.message || err}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  throw lastError;
}

async function runConsumer() {
  while (true) {
    try {
      await waitForKafka();
      await consumer.subscribe({ topic: 'db-changes', fromBeginning: true });

      cdcLogger.info({
        timestamp: new Date().toISOString(),
        action: 'cdc-consumer-subscribed',
        topic: 'db-changes',
        groupId: 'cdc-consumer-group',
      });

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const payload = message.value ? message.value.toString() : null;
          let parsed;

          try {
            parsed = payload ? JSON.parse(payload) : null;
          } catch (err) {
            cdcLogger.error({
              timestamp: new Date().toISOString(),
              action: 'cdc-invalid-json',
              topic,
              partition,
              offset: message.offset,
              error: err.message,
              raw: payload,
            });
            return;
          }

          cdcLogger.info({
            timestamp: new Date().toISOString(),
            action: 'database-change',
            topic,
            partition,
            offset: message.offset,
            change: normalizeCanalMessage(parsed),
          });
        },
      });

      break;
    } catch (err) {
      cdcLogger.error({
        timestamp: new Date().toISOString(),
        action: 'cdc-consumer-retry',
        error: err.message,
      });

      try {
        await consumer.disconnect();
      } catch (_) {
        // ignore disconnect failures and retry
      }

      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

runConsumer().catch((err) => {
  cdcLogger.error({
    timestamp: new Date().toISOString(),
    action: 'cdc-consumer-failure',
    error: err.message,
  });
  process.exit(1);
});
