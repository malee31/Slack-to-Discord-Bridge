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
	/**
	 * Immutable object containing the names of the SQL tables
	 * @type Object
	 */
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

/**
 * Starts up the database and sets it up if it does not already exist. Promise resolves once this is complete.
 */
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

/**
 * Inserts a new row into a table pairing the Slack and Discord IDs together if they are not duplicates
 * @param {string} tableName Name of table to add to
 * @param {string} SlackObjectID An ID from Slack's end
 * @param {string} DiscordObjectID An ID from Discord's end
 * @return {Promise} Resolves once the query completes
 */
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

/**
 * Helper function that returns all rows from a table with a specific name where a specific property has a specific value<br>
 * WARNING: SQL Injection possible for all parameters except SlackObjectID. Do NOT take user input for this function for all properties except SlackObjectID
 * @param {string} SelectProperty Property from table to return from each row. Use '*' to match all
 * @param {string} tableName Table to search (Must contain property)
 * @param  {string} WhereProperty Property to compare with value
 * @param {string} SlackObjectID Value to find in table
 * @return {Promise<Object[]>} Returns matching rows with the selected property
 */
function tableLocateMap(SelectProperty, tableName, WhereProperty, SlackObjectID) {
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

/**
 * Returns the Discord channel id linked with the SlackChannelID passed into this function from the ChannelMap table
 * @param {string} SlackChannelID Timestamp of the Slack channel
 * @return {Promise<string>} Returns the matching Discord channel's ID if found
 */
function locateChannelMap(SlackChannelID) {
	return tableLocateMap("DiscordChannelID", Tables.CHANNEL_MAP, "SlackChannelID", SlackChannelID);
}

/**
 * Returns the Discord thread id equivalent from the ThreadMap table of the matching SlackThreadID
 * @param {string} SlackThreadID Timestamp of the thread's main/original message
 * @return {Promise<string>} Returns the matching Discord thread's ID if found
 */
function locateThreadMap(SlackThreadID) {
	return tableLocateMap("DiscordThreadID", Tables.THREAD_MAP, "SlackThreadID", SlackThreadID);
}

/**
 * Returns all rows from the MessageMap table with the matching SlackMessageID
 * @param {string} SlackMessageID Timestamp of the Slack message
 * @return {Promise<Object[]>} Array of rows with the matching SlackMessageID or an empty array
 */
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