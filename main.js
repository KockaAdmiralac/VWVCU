/**
 * main.js
 *
 * Entry point for VWVCU.
 */
'use strict';

const {writeFile} = require('fs/promises');
const {argv, exit} = require('process');
const http = require('got');
const {CookieJar} = require('tough-cookie');
const xmlparser = require('xml-parser');
const {parse} = require('node-html-parser');
const {google} = require('googleapis');
const Auth = require('./include/auth.js');
const Lister = require('./include/list.js');
const Logger = require('./include/log.js');
const {apiQuery, commafy, roundV} = require('./include/util.js');
const pkg = require('./package.json');
// eslint-disable-next-line node/no-unpublished-require
const {username} = require('./auth/wikia.json');

const USER_AGENT = 'Vocaloid Wiki View Count Updater';
// eslint-disable-next-line max-len
const USER_AGENT_SCRAPER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.79 Safari/537.36';
const VIEWS_REGEX = /\|\s*views\s*=\s*([^\n]+)\n/u;
const LINKS_REGEX = /\|\s*links\s*=\s*([^\n]+)\n/u;
const VIEW_REGEX = /\{\{v\|(\w{2})\|([^}]+)\}\}/gu;
const LINK_REGEX = /\{\{l\|(\w{2})\|([^}|]+)(?:\|([^}]+))?\}\}/gu;
const PIAPRO_REGEX = /<span>閲覧数：<\/span>([\d,]+)/u;

/**
 * Main class of the project.
 */
class VWVCU {
    /**
     * Class constructor.
     */
    constructor() {
        const domain = argv.find(arg => arg.startsWith('--domain='));
        this._domain = domain ? domain.substring(9) : 'vocaloid.fandom.com';
        this._auth = new Auth();
        this._lister = new Lister({
            domain: this._domain,
            file: argv.includes('--list')
        });
        Logger.setup({
            dir: 'logs',
            level: 'debug'
        });
        this._logger = new Logger({
            file: true,
            name: 'main',
            stdout: true
        });
        this._noBot = argv.includes('--no-bot');
        this._noEdit = argv.includes('--no-edit');
        this._logger.info(`${pkg.name} v${pkg.version}: Initializing`);
    }
    /**
     * Runs the Vocaloid Wiki View Count Updater.
     */
    async run() {
        let tokens = null;
        let pages = null;
        try {
            this._logger.info('Authenticating with services...');
            tokens = await this._auth.run();
        } catch (error) {
            this._logger.error('Authentication error:', error);
            return;
        }
        try {
            this._logger.info('Authentication succeeded, listing pages...');
            pages = await this._lister.run(tokens.wikia);
            this._logger.info(pages.length, 'pages to process.');
        } catch (error) {
            this._logger.error('Failed to list pages:', error);
            return;
        }
        while (pages.length > 0) {
            const page = pages.shift();
            this._logger.debug('Processing', page, '...');
            try {
                await this.#processPage(page, pages, tokens);
            } catch (error) {
                this._logger.error('Failed to process page', page, error);
            }
        }
        this._logger.info('Finished!');
    }
    /**
     * Gets page contents and other important information.
     * @param {string} page Page to fetch
     * @param {CookieJar} jar Fandom cookie jar
     * @returns {Promise} Promise to listen on for response
     * @private
     */
    #getPage(page, jar) {
        return apiQuery(this._domain, jar, 'query', 'GET', {
            indexpageids: 1,
            meta: 'tokens',
            prop: 'revisions',
            rvlimit: 1,
            rvprop: 'content',
            rvslots: 'main',
            titles: page,
            type: 'csrf'
        });
    }
    /**
     * Processes views on one page by reading existing content, fetching
     * new views and editing the page if needed.
     * @param {string} page Page to process
     * @param {string[]} pages Pages left to process
     * @param {object} tokens Various authentication tokens
     * @private
     */
    async #processPage(page, pages, tokens) {
        const {error, query} = await this.#getPage(page, tokens.wikia);
        if (error) {
            this._logger.error('Error while fetching page contents', error);
            return;
        }
        const [{title, revisions, missing}] = query.pages;
        const token = query.tokens.csrftoken;
        if (missing) {
            this._logger.error('Page does not exist:', title);
            return;
        }
        const {content} = revisions[0].slots.main;
        const matches = this.#extractContent(content);
        if (matches.length === 0) {
            this._logger.debug('No supported providers to update');
            return;
        }
        let newContent = content;
        for (const match of matches) {
            newContent = await this.#processMatch(
                page, pages, tokens, newContent, match
            );
        }
        if (newContent === content) {
            this._logger.debug('Nothing to change on', title);
        } else {
            await this.#doEdit(title, newContent, token, tokens.wikia);
        }
    }
    /**
     * Processes one match of a supported provider's {{v}} template on the
     * page and replaces the content with new content that has up to
     * date views.
     * @param {string} page Page to process
     * @param {string[]} pages Pages left to process
     * @param {object} tokens Various authentication tokens
     * @param {string} content Old page content
     * @param {object} match Match to process
     * @param {string} match.link ID of the video
     * @param {string} match.provider Video provider
     * @param {number} match.views Current views written on the page
     * @returns {string} New page content after replacement
     */
    async #processMatch(page, pages, tokens, content, {link, provider, views}) {
        try {
            const count = await this[`_${provider}`](link, views, tokens);
            if (roundV(views) === roundV(count)) {
                this._logger.debug(
                    'Not enough view count difference for',
                    provider,
                    'on',
                    page
                );
                return content;
            }
            this._logger.debug('View count: old', views, 'new', count);
            return content.replace(
                `{{v|${provider}|${commafy(views)}}}`,
                `{{v|${provider}|${commafy(count)}}}`
            );
        } catch (viewsError) {
            if (
                viewsError.message && (
                    viewsError.message.startsWith('Daily Limit Exceeded') ||
                    viewsError.message.includes('quota')
                ) ||
                viewsError.response &&
                viewsError.response.code === 403
            ) {
                pages.unshift(page);
                await writeFile('list.txt', pages.join('\n'));
                this._logger.error(
                    'YouTube API daily quota exceeded. Restart the bot ' +
                    'after 1 day with `npm run list`'
                );
                exit(0);
            } else if (viewsError.code === 'ERR_NON_2XX_3XX_RESPONSE') {
                this._logger.error(
                    'Error while fetching view counts for',
                    page,
                    viewsError.response
                );
            } else {
                this._logger.error(
                    'Error while fetching view counts for',
                    page,
                    viewsError
                );
            }
            return content;
        }
    }
    /**
     * Extracts current providers, video IDs and amount of views from page
     * content.
     * @param {string} content Page content
     * @returns {object[]} Matches found in the current content
     * @private
     */
    #extractContent(content) {
        if (!VIEWS_REGEX.exec(content) || !LINKS_REGEX.exec(content)) {
            return [];
        }
        const views = {};
        const matches = [];
        let res3 = null;
        let res4 = null;
        do {
            res3 = VIEW_REGEX.exec(content);
            if (res3 && this[`_${res3[1]}`]) {
                const [_, provider] = res3;
                views[provider] = views[provider] || [];
                views[provider].push(Number(res3[2].replace(/,|\.|\s|\|.*/gu, '')));
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
        return matches;
    }
    /**
     * Fetches bilibili video view count.
     * @param {string} id Video ID
     * @param {number} views Currently registered page views
     */
    async _bb(id, views) {
        if (id.startsWith('au')) {
            // Audio page, ignore.
            return views;
        }
        const response = await http.get(
            `https://www.bilibili.com/video/${id}/`,
            {
                headers: {
                    'User-Agent': USER_AGENT_SCRAPER
                }
            }
        ).text();
        const tree = parse(response, {script: true});
        const script = tree.querySelector('script[type="application/ld+json"]');
        if (!script) {
            throw new Error(`Cannot find Bilibili LD-JSON data for ${id}!`);
        }
        const data = JSON.parse(script.innerHTML);
        if (data.interactionStatistic?.userInteractionCount) {
            return data.interactionStatistic.userInteractionCount;
        }
        throw new Error(`No bilibili view count: ${JSON.stringify(response)}`);
    }
    /**
     * Fetches Niconico video view count.
     * @param {string} id Video ID
     */
    async _nn(id) {
        const response = await http.get(`https://ext.nicovideo.jp/api/getthumbinfo/${id}`, {
            headers: {
                'User-Agent': USER_AGENT
            }
        }).text();
        const counter = xmlparser(response)
            .root
            .children[0]
            .children
            .find(c => c.name === 'view_counter');
        if (!counter) {
            throw new Error(`[nn] unavailable video ${id}`);
        }
        return Number(counter.content);
    }
    /**
     * Fetches view count of a Piapro video.
     * @param {string} id Video ID
     */
    async _pp(id) {
        const response = await http.get(`https://piapro.jp/t/${id}`, {
            headers: {
                'User-Agent': USER_AGENT_SCRAPER
            }
        }).text();
        const res = PIAPRO_REGEX.exec(response);
        if (res) {
            return Number(res[1].replace(/,/gu, ''));
        }
        throw new Error('[piapro] Unable to find view count');
    }
    /**
     * Fetches view count of a SoundCloud track.
     * @param {string} id SoundCloud track ID
     */
    async _sc(id) {
        try {
            const response = await http.get(`https://soundcloud.com/${id}`, {
                headers: {
                    'User-Agent': USER_AGENT_SCRAPER
                }
            }).text();
            const parsed = parse(response, {script: true});
            const scripts = parsed.querySelectorAll('script:not([src])');
            const content = scripts[scripts.length - 1].innerHTML;
            const json = content.slice(
                content.indexOf('[{'),
                content.lastIndexOf('}]') + 2
            );
            try {
                const parsedJson = JSON.parse(json);
                return parsedJson
                    .find(obj => obj.hydratable === 'sound')
                    .data
                    .playback_count;
            } catch (jsonError) {
                throw new Error(`SoundCloud JSON parsing error: ${jsonError}`);
            }
        } catch (error) {
            if (error && error.statusCode && error.statusCode === 404) {
                throw new Error(`[soundcloud] Not found: https://soundcloud.com/${id}`);
            }
            throw error;
        }
    }
    /**
     * Fetches Vimeo video view count.
     * @param {string} id Video ID
     * @param {number} views Currently registered page views
     * @param {object} tokens Various authentication tokens
     */
    async _vm(id, views, tokens) {
        const response = await http.get(`https://api.vimeo.com/videos/${id}`, {
            headers: {
                'Accept': 'application/vnd.vimeo.video+json;version=3.4',
                'Authorization': `Bearer ${tokens.vimeo}`,
                'User-Agent': USER_AGENT
            }
        }).json();
        return response.stats.plays;
    }
    /**
     * Fetches YouTube video view count.
     * @param {string} id Video ID
     * @param {number} views Currently registered page views
     * @param {object} tokens Various authentication tokens
     */
    async _yt(id, views, tokens) {
        const youtube = google.youtube('v3');
        const response = await youtube.videos.list({
            auth: tokens.google,
            id,
            part: 'statistics'
        });
        if (
            !response ||
            !response.data ||
            !(response.data.items instanceof Array)
        ) {
            throw new Error('[youtube] Response data not valid');
        } else if (response.data.items.length === 0) {
            throw new Error(`[youtube] Video with ID ${id} not found`);
        }
        return Number(response.data.items[0].statistics.viewCount);
    }
    /**
     * Edits a page with specified title and content.
     * @param {string} title Page title
     * @param {string} content Page content
     * @param {string} token Token to use in edit
     * @param {CookieJar} jar Fandom cookie jar
     * @private
     */
    async #doEdit(title, content, token, jar) {
        if (this._noEdit) {
            this._logger.debug('Content to post:');
            this._logger.debug(content);
            return;
        }
        try {
            const data = await apiQuery(this._domain, jar, 'edit', 'POST', {
                bot: !this._noBot,
                minor: true,
                summary: `Updating view count ([[User:${username}|automatic]])`,
                text: content,
                title,
                token
            });
            if (data.error) {
                this._logger.error(
                    'MediaWiki API error while editing',
                    title,
                    ':',
                    data.error
                );
            } else {
                this._logger.debug('Finished editing', title);
            }
        } catch (error) {
            this._logger.error('An error occurred while editing', title, error);
        }
    }
}

const client = new VWVCU();
client.run();
