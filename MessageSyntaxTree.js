// Don't mind me lazily using class instances as a lazy way to deep clone objects :P
/**
 * Helper classes used as an intermediate in the bridging process between two services
 * @module SyntaxTree
 */

/**
 * Base for bridge syntax trees
 */
class SyntaxTreeBase {
	// Where the message originates from. In the case of this project, it should always be set to "slack"
	source = "Unknown";
	// Message Timestamp in seconds (Not milliseconds! Add that to additional if it is needed or just calculate it yourself)
	timestamp = 0;
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
			description: "No Description",
			topic: "",
			purpose: "",
			id: ""
		}
	};

	// Miscellaneous. Assign and utilize as needed
	// Meant for data that is specific to your project that the bridging end requires to pass the message on
	/**
	 * Currently Used for
	 * @property {string} channelId Channel ID from Slack
	 * @property {number} deletedTimestamp The timestamp of the message being deleted in delete events
	 * @property {Object} thread Thread data if the message was sent in a thread
	 * @property {Object} thread.timestamp Thread timestamp
	 */
	additional = {}

	// Helper methods that silently validate and set or ignore new values
	// Set property as long as a string is passed in and ignore otherwise. More specific validation to be added
	setIfString(propName, str) {
		if(this[propName] !== undefined && typeof str === "string") {
			this[propName] = str;
		}
	}
}

/**
 * Class used between the original message and bridged message
 * Purpose: Deconstruct messages from whatever form they come in as into a common structure for the bridge to utilize
 * @class MessageSyntaxTree
 * @extends {SyntaxTreeBase}
 */
class MessageSyntaxTree extends SyntaxTreeBase {
	/**
	 * Intended action to be performed using the syntax tree data
	 * @type {string}
	 */
	action = "send";

	/**
	 * Name of the sender. Defaults to "Unknown Pupper"
	 * @type {string}
	 */
	name = "Unknown Pupper";
	/**
	 * URL to sender's profile picture. Defaults to a link to gif profile pic of a dog
	 * @type {string}
	 */
	profilePic = "https://media.giphy.com/media/S8aEKUGKXHl8WEsDD9/giphy.gif";
	/**
	 * The main content of the original message in unparsed form. Defaults to "[No Message Contents]"
	 * @type {string}
 	 */
	unparsedText = "[No Message Contents]";
	/**
	 * Color to use for embeds. Defaults to a shade of blue ("#407ABA")
	 * @type {string}
	 */
	color = "#407ABA";
	/**
	 * Files and embeds' data
	 * @type {Object}
	 * @property {FileData[]} files Array of file data
	 * @property {MessageSyntaxTree[]} embeds Array of additional embed data
	 */
	attachments = {
		files: [],
		embeds: []
	};

	constructor() {
		super();
		/**
		 * Additional property for thread id added
		 * @type {string}
		 */
		this.parseData.thread = {
			id: ""
		};
	}
}

/**
 * Syntax Tree for deletion events
 * @class DeleteSyntaxTree
 * @extends {SyntaxTreeBase}
 */
class DeleteSyntaxTree extends SyntaxTreeBase {
	action = "delete";
	/**
	 * An ID used to identify what message to delete
	 * @type {string}
	 */
	messageIdentifier = "";
	/**
	 * Time of deletion
	 * @type {number}
	 */
	deletedTimestamp = undefined;
	/**
	 * If applicable, the ID of the thread in which the message belongs to
	 * @type {string|number}
	 */
	threadId = undefined;
}

/**
 * Syntax Tree for content changes
 * @class ChangeSyntaxTree
 * @extends {SyntaxTreeBase}
 */
class ChangeSyntaxTree extends MessageSyntaxTree {
	action = "edit";
	/**
	 * The text to replace the old content with
	 * @type {string}
	 */
	newUnparsedText = "[No Message Contents]";
	/**
	 * Time of edit. Never used
	 * @type {number}
	 */
	changeTimestamp = undefined;
}

/**
 * Class for channel data changes. Literally no different from a SyntaxTreeBase instance<br>
 * Extending only to make a clearer name for its purpose
 * @class ChannelSyntaxTree
 * @extends {SyntaxTreeBase}
 */
class ChannelSyntaxTree extends SyntaxTreeBase {
	// Literally no changes
}

module.exports = {
	MessageSyntaxTree,
	DeleteSyntaxTree,
	ChangeSyntaxTree,
	ChannelSyntaxTree
};