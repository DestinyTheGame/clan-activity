const moment = require('moment');

/**
 * Mapping of platforms short hands to full platform names
 *
 * @type {Object}
 * @private
 */
const platforms = {
  'PSN': 'PlayStation Network',
  'BLIZ': 'Battle.Net',
  'XBOX': 'Xbox Live'
};
/**
 * Default date for when no existing date is known.
 *
 * @type {Object}
 * @private
 */
const when = moment('1333-03-07', 'YYYY-MM-DD');
const notFound = {
  activity: when.fromNow(),
  date: when
};

/**
 * Optimize memory of the application by creating a custom class for Members
 * of a clan.
 *
 * @constructor
 * @private
 */
class Member {
  constructor(name, platform, profile) {
    this.platform = platforms[platform];
    this.profile = profile;
    this.name = name;

    //
    // Nulled to prevent class modification once the recent played game history
    // is added.
    //
    this.activity = notFound.activity;
    this.date = notFound.date;
  }

  /**
   * Update the activity with the most recent activity
   *
   * @param {String} last Date of the activity
   * @public
   */
  recent(last) {
    const date = moment(last);

    //
    // As this method can be called multiple times, we only want to store the
    // most recent activity that we found.
    //
    if (date.isAfter(this.date)) {
      this.date = date;
      this.activity = date.fromNow();
    }
  }
}

//
// Expose the module.
//
module.exports = Member;
