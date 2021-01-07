const sqlite = require('sqlite3');
const path = require("path");
const db = new sqlite.Database(path.resolve(__dirname, "database/messageMap.sqlite3"));

module.exports = {
	messageMap,
	dataDump,
	locateMaps
};

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