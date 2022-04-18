/**
 * auth.js
 *
 * Provides authentication with external services.
 */
'use strict';

/**
 * Importing modules.
 */
const fs = require('fs'),
      readline = require('readline'),
      {google} = require('googleapis'),
      http = require('request-promise-native'),
      {Writable} = require('stream'),
      Logger = require('./log.js');

/**
 * Constants.
 */
const USER_AGENT = 'Vocaloid Wiki View Count Updater',
      PROVIDERS = [
          'google',
          'vimeo',
          'wikia'
      ],
      {OAuth2} = google.auth;

/**
 * Handles authentication with video providers.
 */
class Auth {
    /**
     * Begins authentication with services.
     * @returns {Promise} Promise to listen on for response
     */
    run() {
        this._promises = {};
        this._rl = readline.createInterface({
            input: process.stdin,
            output: new Writable({
                write: this._writable.bind(this)
            }),
            terminal: true
        });
        this._logger = new Logger({
            file: true,
            name: 'auth',
            stdout: true
        });
        return Promise.all(PROVIDERS.map(this._mapProvider, this));
    }
    /**
     * Overriden output stream function.
     * @param {*} chunk Input argument 1
     * @param {*} encoding Input argument 2
     * @param {Function} callback Callback after writing
     */
    _writable(chunk, encoding, callback) {
        if (!this._inputtingPassword) {
            process.stdout.write(chunk, encoding);
        }
        callback();
    }
    /**
     * Maps a provider to a Promise that resolves when authenticated.
     * @param {String} provider Provider to map
     * @returns {Promise} Promise to listen on for authentication
     * @private
     */
    _mapProvider(provider) {
        const credentials = require(`../auth/${provider}.json`);
        return new Promise(function(resolve, reject) {
            this._promises[provider] = {
                reject,
                resolve
            };
            this[`_${provider}`](credentials);
        }.bind(this));
    }
    /**
     * Resolves a Promise for a specified provider.
     * @param {String} provider Provider whose promise to resolve
     * @param {*} result Result to resolve the promise with
     */
    _resolve(provider, result) {
        this._promises[provider].resolve([provider, result]);
    }
    /**
     * Rejects a Promise for a specified provider.
     * @param {String} provider Provider whose promise to reject
     * @param {Array} errors List of errors that occurred
     */
    _reject(provider, ...errors) {
        this._promises[provider].reject(errors);
    }
    /**
     * Retrieves a new token for Google services.
     * @private
     */
    _getGoogleToken() {
        const url = this._googleClient.generateAuthUrl({
            // eslint-disable-next-line camelcase
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/youtube.readonly'
            ]
        });
        this._logger.info('1. Authorize this app by visiting this url:', url);
        this._logger.info('2. Enter the token you got here:');
        this._rl.setPrompt('');
        this._rl.once('line', this._onGoogleToken.bind(this));
    }
    /**
     * Callback after writing a line to the console.
     * @param {String} line Line that was written
     * @private
     */
    _onGoogleToken(line) {
        this._googleClient.getToken(line, this._onToken.bind(this));
    }
    /**
     * Callback after obtaining a Google token.
     * @param {Error} err Errors that occurred while obtaining the token
     * @param {String} token Obtained Google token
     */
    _onToken(err, token) {
        if (err) {
            this._reject(
                'google',
                'Error while trying to retrieve access token',
                err
            );
            return;
        }
        this._googleClient.credentials = token;
        fs.writeFile(
            'auth/.youtube.json',
            JSON.stringify(token),
            this._storeGoogleTokenCallback.bind(this)
        );
        this._resolve('google', this._googleClient);
    }
    /**
     * Callback after storing Google token.
     * @param {Error} err Errors that occurred while writing to file
     */
    _storeGoogleTokenCallback(err) {
        if (err) {
            this._logger.error('Error while saving Google token', err);
        }
    }
    /**
     * Handles Google authentication.
     * @param {Object} credentials Saved Google credentials
     * @private
     */
    _google(credentials) {
        const c = credentials.installed;
        this._googleClient = new OAuth2(
            c.client_id,
            c.client_secret,
            c.redirect_uris[0]
        );
        try {
            this._googleClient.credentials = require('../auth/.youtube.json');
            this._resolve('google', this._googleClient);
        } catch (e) {
            this._getGoogleToken();
        }
    }
    /**
     * Handles Vimeo authentication.
     * @param {Object} credentials Saved Google credentials
     * @private
     * @todo Make this fetch a token instead of just reading it
     */
    _vimeo(credentials) {
        this._resolve('vimeo', credentials);
    }
    /**
     * Handles Fandom authentication.
     * @param {Object} credentials Fandom account credentials
     * @private
     */
    _wikia(credentials) {
        this._wikiaJar = http.jar();
        if (credentials.password) {
            this._wikiaLogin(credentials);
        } else {
            this._wikiaName = credentials.username;
            this._logger.info('Enter your Fandom account credentials:');
            this._rl.setPrompt('');
            this._inputtingPassword = true;
            this._rl.once('line', this._onWikiaPassword.bind(this));
        }
    }
    /**
     * Callback after obtaining the user's Fandom password.
     * @param {String} line User's Fandom password
     * @private
     */
    _onWikiaPassword(line) {
        this._inputtingPassword = false;
        this._wikiaLogin({
            password: line,
            username: this._wikiaName
        });
    }
    /**
     * Logs in to Fandom.
     * @param {Object} credentials Fandom account credentials
     * @private
     */
    _wikiaLogin(credentials) {
        http({
            form: credentials,
            headers: {
                'User-Agent': USER_AGENT,
                'X-Fandom-Auth': 1,
                'X-Wikia-WikiaAppsID': 1234
            },
            jar: this._wikiaJar,
            method: 'POST',
            // eslint-disable-next-line max-len
            uri: 'https://services.fandom.com/mobile-fandom-app/fandom-auth/login'
        }).then(this._wikiaSuccess.bind(this))
        .catch(this._wikiaFail.bind(this));
    }
    /**
     * Callback after authentication with Fandom succeeded.
     * @private
     */
    _wikiaSuccess() {
        this._resolve('wikia', this._wikiaJar);
    }
    /**
     * Callback after authentication with Fandom failed.
     * @param {Error} e Error that occurred
     * @private
     */
    _wikiaFail(e) {
        if (e.statusCode === 401) {
            this._reject('wikia', 'Invalid Fandom credentials!');
        } else {
            this._reject('wikia', e);
        }
    }
    /**
     * Cleans up after authentication succeeded.
     */
    clean() {
        this._rl.close();
    }
}

module.exports = Auth;
