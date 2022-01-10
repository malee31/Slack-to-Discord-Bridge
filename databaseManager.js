const sqlite = require('sqlite3');
sqlite.verbose();
const path = require("path");
const db = new sqlite.Database(path.resolve(__dirname, "messageMap.sqlite3"));
const Tables = Object.freeze({
	MESSAGE_MAP: "MessageMap",
	FILE_MAP: "FileMap",
	THREAD_MAP: "ThreadMap",
	CHANNEL_MAP: "ChannelMap"
});

/**
 * Helper functions for managing the SQLite database
 * @module databaseManager
 */
module.exports = {
	Tables,
	tableMap,
	/**
	 * Stores the ID pairs for Slack Messages and Discord Messages (Warning: The function is very much fire and forget. It may also be asynchronous so changes won't be made instantly. Use the callback if you need something to run after it finished or to check to see if it is successful)
	 * @param {string} SMID ID for the Slack Message. There is no proper format for it as long as it is unique so this program uses ChannelID/TimeStamp format but you may change it however you like
	 * @param {string} DMID ID for the Discord Message. Get it from the message.id property
	 * @param {boolean} [textOnly = false] Whether or not this specific Discord Message ID is the one containing the text fields from Slack (Used when looking up which message to edit on message_changed)
	 * @returns {Promise} Resolves when new map is successfully added
	 */
	messageMap,
	locateChannelMap,
	locateThreadMap,
	/**
	 * Looks up all the rows associated with the given Slack Message ID and returns it
	 * @param {string} SMID Slack Message ID to search for
	 * @returns {Promise<Object[]>} Returns an array of all the matching rows. Access the values of the rows using the column title as an object key
	 */
	locateMessageMaps,
};

// Starts up the database and sets it up if it does not already exist

module.exports.startup = new Promise((resolve) => {
	const dbPromisify = query => new Promise((resolve, reject) => {
		db.run(query, err => {
			if(err) reject(err);
			resolve();
		})
	});

	db.on("open", () => {
		console.log("=========== Database Opened ===========");
		resolve(Promise.all([
			dbPromisify("CREATE TABLE IF NOT EXISTS MessageMap (SlackMessageID TEXT NOT NULL, DiscordMessageID TEXT NOT NULL UNIQUE, DiscordThreadID TEXT NOT NULL, SlackChannelID TEXT NOT NULL, DiscordChannelID TEXT NOT NULL, PurelyText BOOLEAN NOT NULL)"),
			dbPromisify("CREATE TABLE IF NOT EXISTS FileMap (SlackFileID TEXT NOT NULL, DiscordMessageID TEXT NOT NULL UNIQUE)"),
			dbPromisify("CREATE TABLE IF NOT EXISTS ChannelMap (SlackChannelID TEXT NOT NULL UNIQUE, DiscordChannelID TEXT NOT NULL UNIQUE)"),
			dbPromisify("CREATE TABLE IF NOT EXISTS ThreadMap (SlackThreadID TEXT NOT NULL UNIQUE, DiscordThreadID TEXT NOT NULL UNIQUE)")
		]));
	});
});

function tableMap(tableName, SlackObjectID, DiscordObjectID) {
	return new Promise((resolve, reject) => {
		// @formatter:off (Ignore this comment, it's just to prevent the IDE from indenting this strangely)
		db.run(`INSERT OR IGNORE INTO ${tableName}
                VALUES (?, ?)`, SlackObjectID, DiscordObjectID, err => {
			if(err) reject(err);
			resolve();
		});
		// @formatter:on
	});
}

function tableLocateMap(SelectProperty, tableName, WhereProperty, SlackObjectID) {
	// WARNING: SQL Injection possible for all parameters except SlackObjectID. Do not take user input for this function other than that!
	return new Promise((resolve, reject) => {
		db.get(`SELECT ${SelectProperty} AS value
                FROM ${tableName}
                WHERE ${WhereProperty} = ?`, SlackObjectID,
			(err, res) => {
				if(err) reject(err);
				resolve((res || {}).value);
			}
		);
	});
}

function locateChannelMap(SlackChannelID) {
	return tableLocateMap("DiscordChannelID", Tables.CHANNEL_MAP, "SlackChannelID", SlackChannelID);
}

function locateThreadMap(SlackThreadID) {
	return tableLocateMap("DiscordThreadID", Tables.THREAD_MAP, "SlackThreadID", SlackThreadID);
}

function locateMessageMaps(SlackMessageID) {
	return new Promise((resolve, reject) => {
		db.all("SELECT * FROM MessageMap WHERE SlackMessageID = ?", SlackMessageID, (err, res) => {
			if(err) reject(err);
			resolve(res || []);
		});
	});
}

/**
 * Add a new entry to the database to link together Discord Message IDs with Slack Message IDs
 * @param {Object} data Object containing all the keys to add to the table. All properties are mandatory
 * @param {string} data.SlackMessageID Slack Message ID to map
 * @param {string} data.DiscordMessageID Discord Message ID to map
 * @param {string} [data.DiscordThreadID = "Main"] Discord Message Thread Channel ID if used
 * @param {string} [data.SlackThreadID = "Main"] Slack Message Thread Channel ID if used
 * @param {boolean} [data.textOnly = false] Whether this Discord Message ID should be the designated text node. This message will be the one edited when editing text if true
 * @return {Promise} Resolves after inserting the new row
 */
function messageMap({
	SlackMessageID,
	DiscordMessageID,
	SlackThreadID = "Main",
	DiscordThreadID = "Main",
	SlackChannelID,
	DiscordChannelID,
	textOnly = false
}) {
	return Promise.all([
		new Promise((resolve, reject) => {
			db.run("INSERT OR IGNORE INTO MessageMap VALUES (?, ?, ?, ?, ?, ?)", SlackMessageID, DiscordMessageID, DiscordThreadID, SlackChannelID, DiscordChannelID, textOnly, err => {
				if(err) reject(err);
				resolve();
			});
		}),
		tableMap(Tables.THREAD_MAP, SlackThreadID, DiscordThreadID)
	]);
}