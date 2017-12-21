const diagnostics = require('diagnostics');
const request = require('request');
const cheerio = require('cheerio');
const Member = require('./member');
const async = require('async');

const debug = diagnostics('activity');

/**
 * Calculate the activity of Bungie clan members.
 *
 * @constructor
 * @param {Object} options Additional configuration.
 * @public
 */
class Activity {
  constructor(options = {}) {
    this.api = options.api || 'https://www.bungie.net';
    this.ratelimit = options.ratelimit || 10;
  }

  /**
   * Retreive the current member list for a given group id.
   *
   * @param {String|Number} group Id of the Bungie group.
   * @param {Function} fn Error first completion callback.
   * @public
   */
  memberlist(group, fn) {
    const members = [];

    return this.scrape(`/en/ClanV2?groupid=${group}`, (err, $) => {
      if (err) return fn(err);

      $('.clanmembers-container .card-list-item').each((i, element) => {
        const member = $(element).find('.card-header-details');
        const title = member.find('.card-title');
        const name = title.text().split('\n')[0].trim();
        const platform = member.find('.platform-type').text();
        const profile = title.find('a').attr('href');

        debug(`Found a new group(${group}) member`, name, platform);
        members.push(new Member(name, platform, profile));
      });

      fn(undefined, members);
    });
  }

  /**
   * Fetch Game History for a given members list.
   *
   * @param {Array} members Array of Member instances.
   * @param {Function} fn Error first completion callback.
   * @public
   */
  history(members, fn) {
    const self = this;

    async.eachLimit(members, this.ratelimit, (member, next) => {
      const gamehistory = member.profile.replace('/Profile/', '/Profile/GameHistory/');

      /**
       * Iterate over characters to the find the most recent one's.
       *
       * @param {Function} complete The completion callback.
       * @private
       */
      function characters(complete) {
        /**
         * Users can have multiple characters and the characters that is displayed
         * first on the page is based on creation-date not last active. So we need
         * to iterate over all chars in order to get accurate activity.
         *
         * @param {Error} err Error that happend during look up.
         * @param {Cheerio} $ Cheerio instance.
         * @param {Object} data Additional request information.
         * @private
         */
        return function characters(err, $, data) {
          if (err) return complete(err);

          const dropdown = $('div.dropdown-item-character-selector');
          const active = dropdown.find('.current-option .select-option').attr('data-value');

          //
          // The characters are hidden in fake HTML dropdown box. so we need to
          // iterate over the fake item and filter out the char that is currently
          // displayed so we don't have to do another request.
          //
          const characters = [];
          dropdown.find('.select-options .select-option').each(function each(index, elem) {
            const value = $(elem).attr('data-value');

            if (value !== active) characters.push(value);
          });

          //
          // We want to map in series here to honor the previous set rate limit or
          // concurrency. As we are doing extra work here for people that have
          // multiple characters
          //
          async.mapSeries(characters, (id, done) => {
            self.scrape(`${data.endpoint}?character=${id}`, (err, $, data) => {
              if (err) return done(err);

              done(undefined, { $, data });
            });
          }, (err, pages) => {
            if (err) return complete(err);

            debug(`fetched all ${pages.length + 1} chars for ${member.name}, updating recent information`);
            pages.concat({ $, data }).forEach((page) => {
              const last = page.$('div.flair-slot div[data-time]').first();
              const time = last.attr('data-time');

              //
              // There are a couple of rare cases where time information is not
              // available on the recent played game history.
              //
              // 1. User deleted all of his chars.
              // 2. Transfered from D1, auto created chars, but never played.
              // 3. Privacy settings prevent us from reading the data.
              //
              if (time) member.recent(time);
              else debug(`${member.name} does not have time information for ${page.data.endpoint}`);
            });

            complete();
          });
        };
      }

      this.scrape(gamehistory, (err, $, url) => {
        if (err) return next(err);

        //
        // We need to verify that we've fetched the game information for the
        // correct platform. If you have multiple platforms linked to your
        // Bungie account it defaults to your "active" platform so we need
        // to switch to a different in case of double platforms.
        //
        const platforms = $('.platforms a.platform-item');
        const platform = platforms.filter((index, item) => {
          return $(item).text().trim() === member.platform;
        });

        if (platforms.length > 1 && !platform.is('.active')) {
          const href = platform.attr('href');
          if (href) {
            debug(`The users(${member.name}) platform(${member.platform}) is not active, re-requesting new URL ${href}`);
            return this.scrape(href, characters(next));
          }

          //
          // So we hit a bit of an edgecase here. The user has multiple platforms
          // but according to the memberlist on Bungie it plays a said platform
          // that does not show up in their profile. Based on this we need to
          // find the most active platform.
          //
          const others = platforms.filter((index, item) => {
            return $(item).attr('href') !== url.endpoint
          }).map((index, item) => {
            return $(item).attr('href');
          });

          return async.each(others, (platform, done) => {
            self.scrape(platform, characters(done));
          }, next);
        }

        return characters(next)(err, $, url);
      });
    }, (err) => {
      if (err) return fn(err);

      //
      // Sort the members list before returning so it's ordered based on users
      // activity.
      //
      fn(undefined, members.sort(function sort(a, b) {
        return a.date.valueOf() - b.date.valueOf();
      }));
    });
  }

  /**
   * Scrape a given URL endpoint with some additional error handling.
   *
   * @param {String} endpoint API endoint we need to hit.
   * @param {Function} fn Error first completion callback.
   * @private
   */
  scrape(endpoint, fn) {
    const url = `${this.api}${endpoint}`;

    debug(`Starting HTTP request for ${url}`);
    request(url, function requested(err, res, body) {
      if (err) {
        debug(`Scraping URL ${url} resulted in an error`, err);
        return fn(err);
      }

      if (res.statusCode !== 200) {
        debug(`URL ${url} returned an invalid status code ${res.statusCode}`);
        return fn(new Error(`Received invalid status code ${res.statusCode}`));
      }

      fn(undefined, cheerio.load(body), {
        endpoint: endpoint,
        res: res
      });
    });
  }
}

//
// Expose the API interface.
//
module.exports = Activity;
