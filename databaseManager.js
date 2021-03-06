const sqlite = require('sqlite3');
const path = require("path");
const db = new sqlite.Database(path.resolve(__dirname, "messageMap.sqlite3"));

/**
 * Helper functions for managing the SQLite database
 * @module databaseManager
 */
module.exports = {
	/**
	 * Stores the ID pairs for Slack Messages and Discord Messages (Warning: The function is very much fire and forget. It may also be asynchronous so changes won't be made instantly. Use the callback if you need something to run after it finished or to check to see if it is successful)
	 * @param {string} SMID ID for the Slack Message. There is no proper format for it as long as it is unique so this program uses ChannelID/TimeStamp format but you may change it however you like
	 * @param {string} DMID ID for the Discord Message. Get it from the message.id property
	 * @param {boolean} [textOnly = false] Whether or not this specific Discord Message ID is the one containing the text fields from Slack (Used when looking up which message to edit on message_changed)
	 * @param {function} [callback] Callback that is passed to db.run AKA IDBDatabase.run. Use if you would like to check if the operation is successful or not or to do something after it finishes
	 */
	messageMap,
	/**
	 * Looks up all the rows associated with the given Slack Message ID and returns it
	 * @param {string} SMID Slack Message ID to search for
	 * @returns {Promise<Object[]>} Returns an array of all the matching rows. Access the values of the rows using the column title as an object key
	 */
	locateMaps,
	/**
	 * Simply prints/dumps the entire database's contents into the console. Use for testing purposes when unable to check the database directly
	 */
	dataDump
};

// Starts up the database and sets it up if it does not already exist
db.on("open", () => {
	console.log("=========== Database Opened ===========");
	db.run("CREATE TABLE IF NOT EXISTS MessageMap (SlackMessageID TEXT NOT NULL, DiscordMessageID TEXT NOT NULL, PurelyText BOOLEAN NOT NULL)");
});

function messageMap(SMID, DMID, textOnly = false, callback) {
	db.run("INSERT INTO MessageMap VALUES (?, ?, ?)", SMID, DMID, textOnly, callback);
}

function locateMaps(SMID) {
	return new Promise((resolve, reject) => {
		db.all("SELECT * FROM MessageMap WHERE SlackMessageID = ?", SMID, (err, res) => {
			if(err) reject(err);
			resolve(res);
		});
	});
}

function dataDump() {
	console.log("DUMPING DATABASE DATA:");
	db.each("SELECT * FROM MessageMap", (err, data) => {
		console.log(JSON.stringify(data));
	});
}