import {format, createLogger, transports, Logger} from 'winston';
import kleur from 'kleur';

interface FileTransportOptions {
    filename: string;
    level: string;
}

const globalFormat = format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.splat(),
    format.colorize(),
    format.printf(({ level, message, timestamp, stack }) => {
      return `[${timestamp}] ${level}: ${stack || message}`;
    })
  );

const fileTransportOptions: FileTransportOptions = {
    filename: 'logs/scripts.log',
    level: 'debug',
};


// Define transports for logging.
const transportOptions = [
  new transports.Console({
    format: format.combine(
      format.colorize(),
      globalFormat
    )
  }),
  new transports.File(fileTransportOptions)
];

/**
 * Logger instance for logging data collection jobs and errors.
 */
const logger: Logger = createLogger({
  level: 'debug',
  format: globalFormat,
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
export default function log(level: string, message: string, error?: any): void {
    let logMsg = kleur.gray(`${message}`);
    if (error) {
        logMsg += " | " + kleur.magenta(`Error: ${error}`);
        error.stack = error.stack?.split('\n').slice(1, error.stack.split('\n').length - 1).join('\n');
        if (error.stack) logMsg += " | " + kleur.red(`\t\t\n    Stack:${error.stack}\n`);
    }
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

export function info(...messages: string[]): void {
    log("info", messages.join(" "))
}

export function error(message: string, error?: Error | any): void {
    log("error", message, error)
}

export function warn(...messages: string[]): void {
    log("warn", messages.join(" "))
}

export function debug(...messages: string[]): void {
    log("debug", messages.join(" "))
}

