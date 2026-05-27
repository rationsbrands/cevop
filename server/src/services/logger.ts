import { createLogger, format, transports } from 'winston';
import { WinstonTransport as AxiomTransport } from '@axiomhq/winston';

const isProduction = process.env.NODE_ENV === 'production';

const axiomTransport =
  process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET
    ? new AxiomTransport({
        token: process.env.AXIOM_TOKEN,
        dataset: process.env.AXIOM_DATASET,
      })
    : null;

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  defaultMeta: { service: 'cevop-api', env: process.env.NODE_ENV },
  transports: [
    new transports.Console({
      format: isProduction ? format.json() : format.combine(format.colorize(), format.simple()),
    }),
    ...(axiomTransport ? [axiomTransport] : []),
  ],
});
