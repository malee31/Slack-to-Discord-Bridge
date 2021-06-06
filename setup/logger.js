const { cyan, yellow } = require("kleur");

module.exports = {
	progressLog,
	warningLog
};

function progressLog(text) {
	console.log(cyan(text));
}

function warningLog(text) {
	console.log(yellow(text));
}