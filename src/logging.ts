import {format, createLogger, transports, Logger as LogManager} from 'winston';

interface FileTransportOptions {
  filename: string;
  level: string;
}

class Logger{
  private filename: string;
  private level: string;
  private fileTransportOptions: FileTransportOptions;
  private transportOptions: any[];
  private self: LogManager;
  constructor(filename?: string, level?: string){
    this.filename = filename || __filename
    this.level = level || 'debug'
    this.fileTransportOptions = {
      filename: this.filename,
      level: this.level,
    }
    this.transportOptions = [
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.simple()
        )
      }),
      new transports.File(this.fileTransportOptions)
    ];

    this.self = createLogger({
      level: 'debug',
      format: format.combine(
        format.cli(),
        format.errors({ stack: true }),
        format.splat(),
        format.printf(({ level, message}) =>
          `${level.toUpperCase()} - ${message}`
        )
      ),
      transports: this.transportOptions,
      exitOnError: false,
    });

  }

  /**
   * Logs messages with different levels to the console and a file.
   *
   * @param level - The log level (e.g., 'error', 'warn', 'info', 'debug').
   * @param message - The main message to be logged.
   * @param error - An optional error object to be logged. If provided, the error message and stack trace will be included in the log.
   *
   * @returns {void}
   */
   log(level: string, message: string, error?: any, params?: object): void {
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
            this.self.error(logMsg);
            break;
          case 'warn':
            this.self.warn(logMsg);
            break;
          case 'info':
            this.self.info(logMsg);
            break;
          case 'debug':
            this.self.debug(logMsg);
            break;
          default:
            this.self.log(level, logMsg);
            break;
        }
    }
}

export default Logger;