// Don't mind me lazily using class instances as a lazy way to deep clone objects :P

/**
 * Class used between the original message and bridged message
 * Purpose: Deconstruct messages from whatever form they come in as into a common structure for the bridge to utilize
 * @class {MessageSyntaxTree}
 */
module.exports = class MessageSyntaxTree {
	// Where the message originates from. In the case of this project, it should always be set to "slack"
	source = "Unknown";
	// Name of sender
	name = "Unknown Pupper";
	// URL to sender's profile picture
	profilePic = "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif";
	// The main content of the original message in unparsed form
	unparsedText = "No Message";
	// Message Timestamp in milliseconds (Not seconds. Add that to additional if it is needed)
	timestamp = 0;
	// Color for embeds
	color = "#407ABA";
	// What action to reflect. Examples: "send", "edit", "pin", "delete"
	action = "none";

	// Data fetched to assist with plugging holes in message while parsing
	// Example: Object linking up a channel ID with a channel name
	parseData = {
		channels: [],
		users: [],
		emojis: [],
		channel: {
			name: "Unknown Channel",
			description: "No Description"
		}
	};
	// Files and Embeds
	attachments = {
		files: [],
		// Embeds will come in the form of another MessageSyntaxTree instance
		embeds: []
	};

	// Miscellaneous. Assign and utilize as needed
	// Meant for data that is specific to your project that the bridging end requires to pass the message on
	/**
	 * Currently Used for
	 * @property {string} channelId Channel ID from Slack
	 * @property {Object} thread Thread data if the message was sent in a thread
	 * @property {Object} thread.timestamp Thread timestamp
 	 */
	additional = {}

	// Helper methods that silently validate and set or ignore new values
	// Set property as long as a string is passed in and ignore otherwise. More specific validation to be added
	setIfString(propName, str) {
		if(this[propName] !== undefined && typeof str === "string") this[propName] = str;
	}
}