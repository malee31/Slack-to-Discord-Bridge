const sqlite = require('sqlite3');
const path = require("path");
const db = new sqlite.Database(path.resolve(__dirname, "database/messageMap.sqlite3"));

module.exports = {
	messageMap,
	dataDump
};

db.on("open", () => {
	console.log("DATABASE OPENED");
	db.run("CREATE TABLE IF NOT EXISTS MessageMap (SlackMessageID TEXT PRIMARY KEY, DiscordMessageID TEXT NOT NULL, UNIQUE(SlackMessageID, DiscordMessageID))");
});

function messageMap(SMID, DMID, callback) {
	db.run("INSERT INTO MessageMap VALUES (?, ?)", SMID, DMID, callback);
}

function dataDump() {
	db.each("SELECT * FROM MessageMap", (err, data) => {
		console.log("DUMPING!");
		console.log(`DATA: ${JSON.stringify(data)}`);
	})
}