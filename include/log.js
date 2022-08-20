/**
 * log.js
 *
 * Provides a simple logging interface.
 * Taken from KockaLogger, commit acf8943a1f67e5b491b550fc17f64a06b5f01fb8.
 */
'use strict';

/**
 * Importing modules.
 */
const fs = require('fs');
const path = require('path');

/**
 * Constants.
 */
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const DEFAULT_LOG_LEVEL = 'debug';
const DEFAULT_LOG_DIRECTORY = 'logs';

/**
 * Simple logging interface.
 */
class Logger {
    /**
     * Class constructor.
     * @param {object} o Method options
     * @param {string} o.name Name of the module using this logger instance
     * @param {boolean} o.stdout Whether to log to standard output
     * @param {boolean} o.file Whether to log to a file, whose name is
     * determined from the logger module's name
     * @param {string} o.level Log level, as defined in `LOG_LEVELS`
     * @param {string} o.dir Which directory to use for logs
     * @param {boolean} o.debug Whether the logger is used in debug mode
     */
    constructor({name, stdout, file, level, dir, debug}) {
        if (typeof name !== 'string') {
            throw new Error('Log must have a name!');
        }
        this._name = name;
        this._level = level || Logger._level;
        this._console = stdout;
        if (file) {
            this._stream = fs.createWriteStream(
                path.resolve(`${dir || Logger._dir}/${name}.log`),
                {flags: 'a'}
            );
        }
        if (!this._console && !this._stream && !this._url) {
            throw new Error('No logging route specified!');
        }
        if (debug || Logger._debug) {
            this._level = LOG_LEVELS.indexOf('debug');
        }
    }
    /**
     * Sets up global logging configuration.
     * @param {object} o Logger options
     * @param {string} o.level Logging level
     * @param {string} o.dir Logging directory
     * @param {boolean} debug Whether debug mode is enabled
     * @static
     */
    static setup({level, dir}, debug) {
        this._level = LOG_LEVELS.indexOf(level || DEFAULT_LOG_LEVEL);
        this._dir = dir || DEFAULT_LOG_DIRECTORY;
        this._debug = debug;
    }
    /**
     * Formats a console color based on color number.
     * @param {number} num Color number
     * @returns {string} Console color
     */
    _color(num) {
        return `\x1b[${num}m`;
    }
    /**
     * Gets console color number for a log level.
     * @param {string} level Log level
     * @returns {number} Console color of the log level
     * @private
     */
    _colorLevel(level) {
        switch (level) {
            // Debug - yellow text
            case 'DEBUG': return 33;
            // Info  - magenta text
            case 'INFO': return 35;
            // Warning - yellow background
            case 'WARN': return 43;
            // Error - red background
            case 'ERROR': return 41;
            // Dunno - reset color
            default: return 0;
        }
    }
    /**
     * Pads a number to two digits in length.
     * @param {number} num Number to pad
     * @returns {string} Padded number
     * @private
     */
    _pad(num) {
        return String(num).padStart(2, 0);
    }
    /**
     * Logs specified messages with the specified level.
     * @param {string} level Log level
     * @param {any[]} messages Messages to log
     * @throws {Error} If an invalid log level is passed
     * @private
     */
    _log(level, ...messages) {
        if (typeof level !== 'string') {
            throw new Error('Invalid log level!');
        }
        if (LOG_LEVELS.indexOf(level) < this._level) {
            return;
        }
        const now = new Date();
        const str = messages.map(this._mapFile).join(' ');
        const date = `${this._pad(now.getDate())}-${this._pad(now.getMonth() + 1)}-${now.getFullYear()}`;
        const time = `${this._pad(now.getHours())}:${this._pad(now.getMinutes())}:${this._pad(now.getSeconds())}`;
        const logLevel = level.toUpperCase();
        const levelColor = this._color(this._colorLevel(logLevel));
        if (this._console) {
            // eslint-disable-next-line no-console
            console[level](`${this._color(34)}[${this._name}]${this._color(2)}[${date} ${time}]${this._color(0)} ${levelColor}[${logLevel}]${this._color(0)}`, ...messages);
        }
        if (this._stream) {
            this._stream.write(`[${date} ${time}] [${logLevel}] ${str}\n`);
        }
    }
    /**
     * Maps objects to how they should be represented in logfiles.
     * @param {*} msg Message to map
     * @returns {string} String representation of the message
     */
    _mapFile(msg) {
        const type = typeof msg;
        switch (type) {
            case 'string':
                return msg;
            case 'number':
            case 'boolean':
                return String(msg);
            case 'function':
                return msg.toString();
            case 'undefined':
                return 'undefined';
            default:
                try {
                    return JSON.stringify(msg);
                } catch (_) {
                    return '[Circular?]';
                }
        }
    }
    /**
     * Debugs specified messages.
     * @param {string[]} messages Messages to debug
     */
    debug(...messages) {
        this._log('debug', ...messages);
    }
    /**
     * Outputs specified information.
     * @param {string[]} messages Information to output
     */
    info(...messages) {
        this._log('info', ...messages);
    }
    /**
     * Outputs specified warnings.
     * @param {string[]} messages Warnings to output
     */
    warn(...messages) {
        this._log('warn', ...messages);
    }
    /**
     * Outputs specified errors.
     * @param {string[]} messages Errors to output
     */
    error(...messages) {
        this._log('error', ...messages);
    }
}

module.exports = Logger;
