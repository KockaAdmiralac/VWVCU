/**
 * main.js
 *
 * Entry point for VWVCU.
 */
'use strict';

/**
 * Importing modules.
 */
const http = require('request-promise-native'),
      xmlparser = require('xml-parser'),
      htmlparser = require('node-html-parser'),
      {google} = require('googleapis'),
      Auth = require('./include/auth.js'),
      Lister = require('./include/list.js'),
      Logger = require('./include/log.js'),
      util = require('./include/util.js'),
      pkg = require('./package.json');

/**
 * Constants.
 */
const USER_AGENT = 'Vocaloid Wiki View Count Updater',
      // eslint-disable-next-line max-len
      USER_AGENT_SCRAPER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
      VIEWS_REGEX = /\|\s*views\s*=\s*([^\n]+)\n/,
      LINKS_REGEX = /\|\s*links\s*=\s*([^\n]+)\n/,
      VIEW_REGEX = /\{\{v\|(\w{2})\|([^}]+)\}\}/g,
      LINK_REGEX = /\{\{l\|(\w{2})\|([^}|]+)(?:\|([^}]+))?\}\}/g,
      SOUNDCLOUD_REGEX = /var c=(\[\{.*\}\]),o=Date.now\(\),i=\[/,
      PIAPRO_REGEX = /<span>閲覧数：<\/span>([\d,]+)/;

/**
 * Main class of the project.
 */
class VWVCU {
    /**
     * Class constructor.
     */
    constructor() {
        this._auth = new Auth();
        this._lister = new Lister();
        Logger.setup({
            dir: 'logs',
            level: 'debug'
        });
        this._logger = new Logger({
            file: true,
            name: 'main',
            stdout: true
        });
        this._noBot = process.argv.includes('--no-bot');
        this._noEdit = process.argv.includes('--no-edit');
        this._logger.info(`${pkg.name} v${pkg.version}: Initializing`);
    }
    /**
     * Runs the Vocaloid Wiki View Count Updater.
     */
    run() {
        this._logger.info('Authenticating with services...');
        this._auth.run()
            .then(this._loggedIn.bind(this))
            .catch(this._loginFailed.bind(this));
    }
    /**
     * Client is logged in.
     * @param {Array<Array>} tokens Promise responses
     * @private
     */
    _loggedIn(tokens) {
        this._auth.clean();
        this._tokens = {};
        tokens.forEach(function([provider, result]) {
            this._tokens[provider] = result;
        }, this);
        util.setJar(this._tokens.wikia);
        this._logger.info('Authentication succeeded, listing pages...');
        this._lister.run()
            .then(this._onList.bind(this))
            .catch(this._listFailed.bind(this));
    }
    /**
     * Failure to authenticate with services.
     * @param {Array} errors Login errors
     * @private
     */
    _loginFailed(errors) {
        this._logger.error('Authentication failed:', ...errors);
        this._auth.clean();
    }
    /**
     * List of pages has been obtained.
     * @param {Array<String>} pages List of pages to run through
     * @private
     */
    _onList(pages) {
        this._pages = pages;
        this._logger.info(pages.length, 'pages to process.');
        this._next();
    }
    /**
     * Pages failed to list.
     * @param {Error} e Error that occurred
     * @private
     */
    _listFailed(e) {
        this._logger.error('Failed to obtain a list of pages', e);
    }
    /**
     * Processes the next page in the queue.
     * @private
     */
    _next() {
        const page = this._pages.shift();
        if (page) {
            this._logger.debug('Processing', page, '...');
            this._getPage(page)
                .then(this._processPage.bind(this))
                .catch(this._getFailed.bind(this));
        } else {
            this._logger.info('Finished!');
        }
    }
    /**
     * Gets page contents and other important information.
     * @param {String} page Page to fetch
     * @returns {Promise} Promise to listen on for response
     * @private
     */
    _getPage(page) {
        return util.apiQuery('query', 'GET', {
            indexpageids: 1,
            intoken: 'edit',
            prop: 'revisions|info',
            rvlimit: 1,
            rvprop: 'content',
            titles: page
        });
    }
    /**
     * Processes page contents to extract important information
     * and passes it on to services.
     * @param {Object} data MediaWiki API response
     * @private
     */
    _processPage(data) {
        if (data.error) {
            this._logger.error(
                'MediaWiki API error in fetching page contents',
                data.error
            );
            this._next();
            return;
        }
        const id = Number(data.query.pageids[0]),
              page = data.query.pages[id],
              {title} = page;
        if (id === -1) {
            this._logger.error('Page does not exist:', title);
            this._next();
            return;
        }
        const content = page.revisions[0]['*'],
              token = page.edittoken,
              [promises, matches] = this._extractContent(content);
        if (promises.length) {
            Promise.all(promises)
                .then(this._generateCallback(title, content, token, matches))
                .catch(this._generateErrorCallback(title));
        } else {
            this._logger.debug('No supported providers to update');
            this._next();
        }
    }
    /**
     * Callback after failing to obtain page contents.
     * @param {Error} e Error that occurred while fetching page contents
     * @private
     */
    _getFailed(e) {
        this._logger.error('An error occurred while fetching page contents', e);
        this._next();
    }
    /**
     * Gets requests from video providers and view count based on page content.
     * @param {String} content Page content
     * @returns {Array} Promises to listen on for provider response and
     *                  current view count
     * @private
     */
    _extractContent(content) {
        if (!VIEWS_REGEX.exec(content) || !LINKS_REGEX.exec(content)) {
            return [[], {}];
        }
        const views = {},
              matches = [];
        let res3 = null, res4 = null;
        do {
            res3 = VIEW_REGEX.exec(content);
            if (res3 && this[`_${res3[1]}`]) {
                const provider = res3[1];
                views[provider] = views[provider] || [];
                views[provider].push(Number(res3[2].replace(/,|\.|\s/g, '')));
            }
        } while (res3);
        VIEW_REGEX.lastIndex = 0;
        do {
            res4 = LINK_REGEX.exec(content);
            if (res4 && this[`_${res4[1]}`] && views[res4[1]]) {
                matches.push({
                    link: res4[2],
                    provider: res4[1],
                    views: views[res4[1]].shift()
                });
            } else if (res4 && this[`_${res4[1]}`] && !views[res4[1]]) {
                this._logger.warn('No view count found for', res4[1]);
            }
        } while (res4);
        LINK_REGEX.lastIndex = 0;
        return [matches.map(m => new Promise(function(resolve, rej) {
            this[`_${m.provider}`](m.link, resolve, rej);
        }.bind(this))), matches];
    }
    /**
     * Fetches bilibili video view count.
     * @param {String} id Video ID
     * @param {Function} resolve Promise resolving function
     * @param {Function} reject Promise rejection function
     */
    _bb(id, resolve, reject) {
        http({
            headers: {
                'User-Agent': USER_AGENT
            },
            json: true,
            method: 'GET',
            qs: {
                aid: id
            },
            uri: 'https://api.bilibili.com/x/web-interface/archive/stat'
        }).then(function(d) {
            if (d && d.data && d.data.view) {
                resolve(d.data.view);
            } else {
                reject(`No bilibili view count: ${JSON.stringify(d)}`);
            }
        }).catch(reject);
    }
    /**
     * Fetches Niconico video view count.
     * @param {String} id Video ID
     * @param {Function} resolve Promise resolving function
     * @param {Function} reject Promise rejection function
     */
    _nn(id, resolve, reject) {
        http({
            headers: {
                'User-Agent': USER_AGENT
            },
            method: 'GET',
            uri: `https://ext.nicovideo.jp/api/getthumbinfo/${id}`
        }).then(function(d) {
            const counter = xmlparser(d)
                .root
                .children[0]
                .children
                .find(c => c.name === 'view_counter');
            if (!counter) {
                reject(`[nn] unavailable video ${id}`);
                return;
            }
            resolve(Number(counter.content));
        }).catch(reject);
    }
    /**
     * Fetches view count of a Piapro video.
     * @param {String} id Video ID
     * @param {Function} resolve Promise resolving function
     * @param {Function} reject Promise rejection function
     */
    _pp(id, resolve, reject) {
        http({
            headers: {
                'User-Agent': USER_AGENT_SCRAPER
            },
            method: 'GET',
            uri: `https://piapro.jp/t/${id}`
        }).then(function(d) {
            const res = PIAPRO_REGEX.exec(d);
            if (res) {
                resolve(Number(res[1].replace(/,/g, '')));
            } else {
                reject('[piapro] Unable to find view count');
            }
        }).catch(reject);
    }
    /**
     * Fetches view count of a SoundCloud track.
     * @param {String} id SoundCloud track ID
     * @param {Function} resolve Promise resolving function
     * @param {Function} reject Promise rejection function
     */
    _sc(id, resolve, reject) {
        http({
            headers: {
                'User-Agent': USER_AGENT_SCRAPER
            },
            method: 'GET',
            uri: `https://soundcloud.com/${id}`
        }).then(function(d) {
            const parsed = htmlparser.parse(d, {script: true}),
                  scripts = parsed.querySelectorAll('script'),
                  res = SOUNDCLOUD_REGEX
                      .exec(scripts[scripts.length - 1].innerHTML);
            if (res) {
                try {
                    resolve(JSON.parse(res[1])[5].data[0].playback_count);
                } catch (e) {
                    reject(`SoundCloud JSON parsing error: ${e.toString()}`);
                }
            } else {
                reject('Failed to extract data from SoundCloud\'s JavaScript');
            }
        }).catch(function(e) {
            if (e && e.statusCode && e.statusCode === 404) {
                reject(`[soundcloud] Not found: https://soundcloud.com/${id}`);
            } else {
                reject(e);
            }
        });
    }
    /**
     * Fetches Vimeo video view count.
     * @param {String} id Video ID
     * @param {Function} resolve Promise resolving function
     * @param {Function} reject Promise rejection function
     */
    _vm(id, resolve, reject) {
        http({
            headers: {
                'Accept': 'application/vnd.vimeo.video+json;version=3.4',
                'Authorization': `Bearer ${this._tokens.vimeo}`,
                'User-Agent': USER_AGENT
            },
            json: true,
            method: 'GET',
            uri: `https://api.vimeo.com/videos/${id}`
        }).then(function(d) {
            resolve(d.stats.plays);
        }).catch(reject);
    }
    /**
     * Fetches YouTube video view count.
     * @param {String} id Video ID
     * @param {Function} resolve Promise resolving function
     * @param {Function} reject Promise rejection function
     */
    _yt(id, resolve, reject) {
        const youtube = google.youtube('v3');
        youtube.videos.list({
            auth: this._tokens.google,
            id,
            part: 'statistics'
        }, function(err, response) {
            if (err) {
                reject(err);
                return;
            }
            if (
                !response ||
                !response.data ||
                !(response.data.items instanceof Array)
            ) {
                reject('[youtube] Response data not valid');
                return;
            } else if (response.data.items.length === 0) {
                reject(`[youtube] Video with ID ${id} not found`);
                return;
            }
            resolve(Number(response.data.items[0].statistics.viewCount));
        });
    }
    /**
     * Generates a callback function for when video fetching promises.
     * are resolved
     * @param {String} title Page title
     * @param {String} content Page content
     * @param {String} token User's edit token for the page
     * @param {Object} matches Video information matches in page content
     * @returns {Function} Callback function
     * @private
     */
    _generateCallback(title, content, token, matches) {
        return function(results) {
            let newcontent = content;
            if (!results.some(
                (count, i) => this._roundV(matches[i].views) !==
                              this._roundV(count)
            )) {
                this._logger.debug(
                    title, ': Not enough view count difference, returning.'
                );
                this._next();
                return;
            }
            results.forEach(function(count, i) {
                const {provider, views} = matches[i];
                this._logger.debug(
                    'Old view count', views,
                    ', new view count', count
                );
                newcontent = newcontent.replace(
                    `{{v|${provider}|${util.commafy(views)}}}`,
                    `{{v|${provider}|${util.commafy(count)}}}`
                );
            }, this);
            if (newcontent === content) {
                this._logger.debug('Nothing to change on', title);
                this._next();
            } else {
                this._doEdit(title, newcontent, token);
            }
        }.bind(this);
    }
    /**
     * Replicates {{v}} template's number rounding.
     * @param {Number} num Number of views
     * @returns {String} Rounded number of views
     */
    _roundV(num) {
        const len = String(num).length;
        switch (len) {
            case 1:
                return String(num);
            case 2:
                return String(Math.round(num / 10) * 10);
            case 3:
                return `${String(num).slice(0, -1)}0`;
            case 4:
            case 5:
            case 6:
                return `${String(num).slice(0, -2)}00`;
            case 7:
            case 8:
                return `${String(num).slice(0, -3)}000`;
            default:
                return 'unsupported';
        }
    }
    /**
     * Generates a callback function for when video view count fetching fails.
     * @param {String} title Page title
     * @returns {Function} Callback function
     * @private
     */
    _generateErrorCallback(title) {
        return function(...errors) {
            this._logger.error(
                'An error occurred while fetching view counts for', title,
                errors
            );
            this._next();
        }.bind(this);
    }
    /**
     * Edits a page with specified title and content.
     * @param {String} title Page title
     * @param {String} content Page content
     * @param {String} token Token to use in edit
     * @private
     */
    _doEdit(title, content, token) {
        if (this._noEdit) {
            this._logger.debug('Content to post:');
            this._logger.debug(content);
            this._next();
            return;
        }
        util.apiQuery('edit', 'POST', {
            bot: true,
            minor: true,
            summary: 'Updating view count ([[User:KockaBot|automatic]])',
            text: content,
            title,
            token
        }).then(this._generateEditCallback(title))
        .catch(this._generateEditErrorCallback(title));
    }
    /**
     * Generates edit callback.
     * @param {String} title Page title
     * @returns {Function} Edit callback function
     */
    _generateEditCallback(title) {
        return function(data) {
            if (data.error) {
                this._logger.error(
                    'MediaWiki API error while editing', title,
                    ':', data.error
                );
            } else {
                this._logger.debug('Finished editing', title);
            }
            this._next();
        }.bind(this);
    }
    /**
     * Generated edit callback when the edit failed.
     * @param {String} title Page title
     * @returns {Function} Edit error callback function
     */
    _generateEditErrorCallback(title) {
        return function(e) {
            this._logger.error('An error occurred while editing', title, e);
            this._next();
        }.bind(this);
    }
}

const client = new VWVCU();
client.run();
