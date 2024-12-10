import {format, createLogger, transports, Logger} from 'winston';

interface FileTransportOptions {
    filename: string;
    level: string;
}

const fileTransportOptions: FileTransportOptions = {
    filename: 'log.log',
    level: 'debug',
};


// Define transports for logging.
const transportOptions = [
  new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }),
  new transports.File(fileTransportOptions)
];

/**
 * Logger instance for logging data collection jobs and errors.
 */
const logger: Logger = createLogger({
  level: 'debug',
  format: format.combine(
    format.cli(),
    format.errors({ stack: true }),
    format.splat(),
    format.printf(({ level, message}) =>
      `${level.toUpperCase()} - ${message}`
    )
  ),
  transports: transportOptions,
  exitOnError: false,
});

/**
 * Logs messages with different levels to the console and a file.
 *
 * @param level - The log level (e.g., 'error', 'warn', 'info', 'debug').
 * @param message - The main message to be logged.
 * @param error - An optional error object to be logged. If provided, the error message and stack trace will be included in the log.
 *
 * @returns {void}
 */
export default function log(level: string, message: string, error?: any, params?: object): void {
    let logMsg = `${new Date().toISOString()}\t`;
    logMsg += `| [*] Message: ${message}\t`;
    if (error) {
        logMsg += `| [*] Error: ${error}\t`;
        error.stack = error.stack?.split('\n').slice(1, error.stack.split('\n').length - 1).join('\n');
        if (error.stack) logMsg += `\t| [x] Stack: ${error.stack}\n`;
        if (params) logMsg += `\t[x] root: ${params}\n`;
    }
    logMsg +=  '\n\n';
    switch (level) {
        case 'error':
          logger.error(logMsg);
          break;
        case 'warn':
          logger.warn(logMsg);
          break;
        case 'info':
          logger.info(logMsg);
          break;
        case 'debug':
          logger.debug(logMsg);
          break;
        default:
          logger.log(level, logMsg);
          break;
      }
}