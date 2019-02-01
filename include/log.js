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
const fs = require('fs'),
      path = require('path');

/**
 * Constants.
 */
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'],
      DEFAULT_LOG_LEVEL = 'debug',
      DEFAULT_LOG_DIRECTORY = 'logs';

/**
 * Simple logging interface.
 */
class Logger {
    /**
     * Class constructor.
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
     * @param {String} level Logging level
     * @param {Boolean} debug Whether debug mode is enabled
     * @param {String} dir Logging directory
     * @static
     */
    static setup({level, dir}, debug) {
        this._level = LOG_LEVELS.indexOf(level || DEFAULT_LOG_LEVEL);
        this._dir = dir || DEFAULT_LOG_DIRECTORY;
        this._debug = debug;
    }
    /**
     * Formats a console color based on color number.
     * @param {Number} num Color number
     * @returns {String} Console color
     */
    _color(num) {
        return `\x1b[${num}m`;
    }
    /**
     * Gets console color number for a log level.
     * @param {String} level Log level
     * @returns {Number} Console color of the log level
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
     * @param {Number} num Number to pad
     * @returns {String} Padded number
     * @private
     */
    _pad(num) {
        return String(num).padStart(2, 0);
    }
    /**
     * Logs specified messages with the specified level.
     * @param {String} level Log level
     * @param {Array} messages Messages to log
     * @private
     */
    _log(level, ...messages) {
        if (typeof level !== 'string') {
            throw new Error('Invalid log level!');
        }
        if (LOG_LEVELS.indexOf(level) < this._level) {
            return;
        }
        const now = new Date(),
              str = messages.map(this._mapFile).join(' '),
              date = `${this._pad(now.getDate())}-${this._pad(now.getMonth() + 1)}-${now.getFullYear()}`,
              time = `${this._pad(now.getHours())}:${this._pad(now.getMinutes())}:${this._pad(now.getSeconds())}`,
              logLevel = level.toUpperCase(),
              levelColor = this._color(this._colorLevel(logLevel));
        if (this._console) {
            console[level](`${this._color(34)}[${this._name}]${this._color(2)}[${date} ${time}]${this._color(0)} ${levelColor}[${logLevel}]${this._color(0)}`, ...messages);
        }
        if (this._stream) {
            this._stream.write(`[${date} ${time}] [${logLevel}] ${str}\n`);
        }
    }
    /**
     * Maps objects to how they should be represented in logfiles.
     * @param {*} msg Message to map
     * @returns {String} String representation of the message
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
                } catch (e) {
                    return '[Circular?]';
                }
        }
    }
    /**
     * Debugs specified messages.
     * @param {Array<String>} messages Messages to debug
     */
    debug(...messages) {
        this._log('debug', ...messages);
    }
    /**
     * Outputs specified information.
     * @param {Array<String>} messages Information to output
     */
    info(...messages) {
        this._log('info', ...messages);
    }
    /**
     * Outputs specified warnings.
     * @param {Array<String>} messages Warnings to output
     */
    warn(...messages) {
        this._log('warn', ...messages);
    }
    /**
     * Outputs specified errors.
     * @param {Array<String>} messages Errors to output
     */
    error(...messages) {
        this._log('error', ...messages);
    }
}

module.exports = Logger;
