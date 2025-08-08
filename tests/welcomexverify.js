const Canvas = require("canvas");
const Discord = require("discord.js");
const { fetch } = require("undici");
const moment = require('moment');
const path = require('path');
const fs = require('fs');

require("dotenv").config
let apikey = process.env.HPAPIKEY

const { getUUID, getUsername, bg } = require("../../utils/helpers/misc");
const chroma = require("chroma-js");

const commafy = require("commafy");

// Debug font registration
console.log("Attempting to register font...");
try {
    const fontPath = './src/utils/assets/fonts/RedHatDisplay-Black.otf';
    console.log(`Font path: ${fontPath}`);
    console.log(`Font exists: ${fs.existsSync(fontPath)}`);
    Canvas.registerFont(fontPath, { family: 'RedHat' });
    console.log("Font registration successful");
} catch (error) {
    console.error("Font registration failed:", error);
}

const dim = {
	height: 470,
	width: 800,
	margin: 25,
};

const generatewelcome = async (username, api, gapi, userobject, count) => {
    console.log(`Starting generatewelcome for username: ${username}`);

	let discrim = userobject.discriminator
	let usernamee = userobject.username
	let usertag
    if (discrim == 0) {
        usertag = usernamee
    } else {
        usertag = usernamee + "#" + discrim
    }

	//functions

	async function getRank(api) {
		try {  
			if (!api) {
				console.log("No API data provided to getRank");
				return "NONE";
			}
			let data = api;
			let rank = data.newPackageRank;
			if (rank == "NONE" || rank == undefined) return "NONE";
			else if (rank == "VIP") return "VIP";
			else if (rank == "VIP_PLUS") return "VIP+";
			else if (rank == "MVP") return "MVP";
			else if (rank == "MVP_PLUS"){
				if (data.monthlyPackageRank == "SUPERSTAR") return "MVP++";
				else if (data.rank == "YOUTUBER") return "YOUTUBER";
				else if (data.rank == "GAME_MASTER") return "GAME_MASTER";
				else if (data.rank == "ADMIN") return "ADMIN";
				else return "MVP+";
			}
			return "NONE";
		} catch (err) {
			console.log("Error in getRank:", err);
			return "NONE";
		}
	}
	
	async function getRankColor(api) {
		let data = api
	if (await getRank(api) == "MVP+" || await getRank(api) == "MVP++") {
		let color = data.rankPlusColor
	  return color;
	  
	} else if (await getRank(api) == "VIP+") {
		let color = "GOLD";
		return color;
	
	} else return "NONE"
	}
	const colorDictionary = {
        RED: "#FF5555",
        GOLD: "#FFAA00",
        GREEN: "#55FF55",
        YELLOW: "#FFFF55",
        LIGHT_PURPLE: "#FF55FF",
        WHITE: "#FFFFFF",
        BLUE: "#5555FF",
        DARK_GREEN: "#00AA00",
        DARK_RED: "#AA0000",
        DARK_AQUA: "#00AAAA",
        DARK_PURPLE: "#AA00AA",
        DARK_GRAY: "#555555",
        BLACK: "#000000",
        DARK_BLUE: "#0000AA",
        GRAY: "#AAAAAA",
    }
    function colorFromList(color) {
        let returnedcolor;
        try {  
          if (color == "RED") {
              returnedcolor = colorDictionary.RED
              return returnedcolor
          } else if (color == "GOLD") {
              returnedcolor = colorDictionary.GOLD
              return returnedcolor
          } else if (color == "GREEN" ) {
                returnedcolor = colorDictionary.GREEN
                return returnedcolor
          } else if (color == "YELLOW") {
                returnedcolor = colorDictionary.YELLOW
                return returnedcolor
          } else if (color == "LIGHT_PURPLE") {
                returnedcolor = colorDictionary.LIGHT_PURPLE
                return returnedcolor
          } else if (color == "WHITE") {
                returnedcolor = colorDictionary.WHITE
                return returnedcolor
          } else if (color == "BLUE") {
                returnedcolor = colorDictionary.BLUE
                return returnedcolor
          } else if (color == "DARK_GREEN") {
                returnedcolor = colorDictionary.DARK_GREEN
                return returnedcolor
          } else if (color == "DARK_RED") {
                returnedcolor = colorDictionary.DARK_RED
                return returnedcolor
          } else if (color == "DARK_AQUA") { 
                returnedcolor = colorDictionary.DARK_AQUA
                return returnedcolor
          } else if (color == "DARK_PURPLE") {
                returnedcolor = colorDictionary.DARK_PURPLE
                return returnedcolor
          } else if (color == "DARK_GRAY") {
                returnedcolor = colorDictionary.DARK_GRAY
                return returnedcolor
          } else if (color == "BLACK") {
                returnedcolor = colorDictionary.BLACK
                return returnedcolor
          } else if (color == "DARK_BLUE") {
                returnedcolor = colorDictionary.DARK_BLUE
                return returnedcolor
          } else {
                returnedcolor = colorDictionary.YELLOW
                return returnedcolor
          }
        } catch (err) {
          console.log("Error in colorFromList:", err);
          return undefined;
        }
    }
	function tagColor() {
        let color
		if (gapi == null) {
		color = "GRAY"
		} else {
		color = gapi.tagColor
		}
        try {  
          if (color == "YELLOW") {
              returnedcolor = colorDictionary.YELLOW
              return returnedcolor
          } else if (color == "GOLD") {
              returnedcolor = colorDictionary.GOLD
              return returnedcolor
          } else if (color == "DARK_AQUA" ) {
                returnedcolor = colorDictionary.DARK_AQUA
                return returnedcolor
          } else if (color == "DARK_GREEN") {
                returnedcolor = colorDictionary.DARK_GREEN
                return returnedcolor
          } else {
                returnedcolor = colorDictionary.GRAY
                return returnedcolor
          }
        } catch (err) {
          console.log("Error in tagColor:", err);
          return undefined;
        }
    }

	let guildname
	if (gapi == null) {
		guildname = "None"
	} else {
		guildname = gapi.name
	}


	// Get player skin
	console.log("Getting player UUID and username");
	let uuid;
	try {
		uuid = await getUUID(username);
		console.log(`UUID obtained: ${uuid}`);
	} catch (err) {
		console.error("Error getting UUID:", err);
	}
	
	let playerskin = `https://skins.mcstats.com/bust/${uuid}`;
	console.log(`Player skin URL: ${playerskin}`);
	
	let properign;
	try {
		properign = await getUsername(username);
		console.log(`Proper IGN obtained: ${properign}`);
	} catch (err) {
		console.error("Error getting proper username:", err);
		properign = username; // Fallback
	}
	
	function calcLevel() {
		try {
		let exp = api.networkExp;
		var nwlevelfloat = (Math.sqrt(exp + 15312.5) - 125 / Math.sqrt(2)) / (25 * Math.sqrt(2));
		const nwlevel = Math.round(parseFloat(nwlevelfloat))
		return nwlevel
		} catch (e) {
			console.log("Error calculating level:", e);
			return "?"
		}
	}
	let nwlevel = calcLevel()
	console.log(`Network level calculated: ${nwlevel}`);

	console.log("Creating canvas");
	const canvas = Canvas.createCanvas(dim.width, dim.height);
	const ctx = canvas.getContext("2d");

    // Debug current directory and file existence
    console.log(`Current directory: ${process.cwd()}`);
    
    // Get correct absolute paths for assets
    const assetsDir = path.join(__dirname, "..", "..", "utils", "assets");
    console.log(`Assets directory: ${assetsDir}`);
    
    const framePath = path.join(assetsDir, "frame.png");
    const frame2Path = path.join(assetsDir, "frame2.png");
    const gradientPath = path.join(assetsDir, "gradient.png");
    
    // Check if files exist
    console.log(`Frame path: ${framePath}`);
    console.log(`Frame exists: ${fs.existsSync(framePath)}`);
    
    console.log(`Frame2 path: ${frame2Path}`);
    console.log(`Frame2 exists: ${fs.existsSync(frame2Path)}`);
    
    console.log(`Gradient path: ${gradientPath}`);
    console.log(`Gradient exists: ${fs.existsSync(gradientPath)}`);

    // Load images with error handling
    let frame, frame2, gradient, skin;
    
    try {
        console.log("Loading frame image");
        frame = await Canvas.loadImage(framePath);
        console.log("Frame loaded successfully");
    } catch (err) {
        console.error("Error loading frame:", err);
        // Create fallback image
        frame = new Canvas.Image();
    }
    
    try {
        console.log("Loading frame2 image");
        frame2 = await Canvas.loadImage(frame2Path);
        console.log("Frame2 loaded successfully");
    } catch (err) {
        console.error("Error loading frame2:", err);
        frame2 = new Canvas.Image();
    }
    
    try {
        console.log("Loading gradient image");
        gradient = await Canvas.loadImage(gradientPath);
        console.log("Gradient loaded successfully");
    } catch (err) {
        console.error("Error loading gradient:", err);
        gradient = new Canvas.Image();
    }

	// Load Skin with error handling
	try {
		console.log("Loading skin image");
		skin = await Canvas.loadImage(playerskin);
		console.log("Skin loaded successfully");
	} catch (err) {
		console.error("Error loading skin:", err);
		// Create fallback image
		skin = new Canvas.Image();
	}

    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
	ctx.save();
    
    console.log("Drawing frame");
    //draw frame
	ctx.globalAlpha = 0.9;
    try {
        ctx.drawImage(
            frame,
            500,
            dim.height/2-115
        );
        console.log("Frame drawn successfully");
    } catch (err) {
        console.error("Error drawing frame:", err);
    }
    
    try {
        ctx.drawImage(
            frame2,
            -20,
            dim.height/2-120
        );
        console.log("Frame2 drawn successfully");
    } catch (err) {
        console.error("Error drawing frame2:", err);
    }
    
	ctx.globalAlpha = 1;
	
	// Calculate new skin dimensions
	const skinWidth = 128; 
	const skinHeight = 128; 
	const scale = 1.05; 
	const newWidth = skinWidth * scale;
	const newHeight = skinHeight * scale;

	// Adjust position to center the larger skin
	const skinX = 562 + (skinWidth - newWidth) / 2; 
	const skinY = dim.height/2 - 80 + (skinHeight - newHeight) / 2;

	// Draw Skin
	try {
		ctx.drawImage(
			skin,
			skinX,
			skinY,
			newWidth,
			newHeight
		);
		console.log("Skin drawn successfully");
	} catch (err) {
		console.error("Error drawing skin:", err);
	}
	
	ctx.globalAlpha = 0.8;
	try {
		ctx.drawImage(
			gradient,
			546,
			dim.height/2+7
		);
		console.log("Gradient drawn successfully");
	} catch (err) {
		console.error("Error drawing gradient:", err);
	}
	ctx.globalAlpha = 1;

    
	ctx.restore();
    let newtopstring
    try {
        const rank = await getRank(api);
        console.log(`Player rank: ${rank}`);
        if (rank == "NONE") {
            newtopstring = properign;
        } else {
            newtopstring = "[" + rank + "]" + " " + properign;
        }
    } catch (err) {
        console.error("Error getting rank for top string:", err);
        newtopstring = properign;
    }
    
    let color, rankcolor;
    try {
        color = await getRankColor(api);
        console.log(`Rank color: ${color}`);
        rankcolor = colorFromList(color);
        console.log(`Converted rank color: ${rankcolor}`);
    } catch (err) {
        console.error("Error getting rank color:", err);
    }
    
    let tagcolor;
    try {
        tagcolor = tagColor();
        console.log(`Tag color: ${tagcolor}`);
    } catch (err) {
        console.error("Error getting tag color:", err);
    }

	function makeRankString(str, rank, rankcolor, str2, x, y) {
	    console.log(`Making rank string: "${str}", rank: ${rank}`);
		let bigrankcolor;
		if (rank == "NONE") {
			bigrankcolor = "#AAAAAA";
		} else if (rank == "VIP") {
			bigrankcolor = "#55FF55";
		} else if (rank == "VIP+") {
			bigrankcolor = "#55FF55";
		} else if (rank == "MVP") {
			bigrankcolor = "#55FFFF";
		} else if (rank == "MVP+") {
			bigrankcolor = "#55FFFF";
		} else if (rank == "YOUTUBER") {
			bigrankcolor = "#FF5555";
		} else if (rank == "GAME_MASTER") {
			bigrankcolor = "#00AA00";
		} else if (rank == "ADMIN") {
			bigrankcolor = "FF5555";
		} else if (rank == "MVP++") {
			bigrankcolor = "#FFAA00";
		} else {
			bigrankcolor = "white";
		}
		console.log(`Using big rank color: ${bigrankcolor}`);
		
		try {
			ctx.font = "25px RedHat";
			for (var i = 0; i <= str.length; ++i) {
				var ch = str.charAt(i);
				if (ch == "+") {
					ctx.shadowColor = chroma(rankcolor).darken(3).hex();
					ctx.shadowBlur = 0;
					ctx.shadowOffsetX = 3;
					ctx.shadowOffsetY = 3;
					ctx.fillStyle = rankcolor;
					
					ctx.fillText(ch, x, y);
					ctx.shadowOffsetX = 0;
					ctx.shadowOffsetY = 0;
					x += ctx.measureText(ch).width;
				} else {
					ctx.shadowColor = chroma(bigrankcolor).darken(3).hex();
					ctx.shadowBlur = 0;
					ctx.shadowOffsetX = 3;
					ctx.shadowOffsetY = 3;
					ctx.fillStyle = bigrankcolor;
					
					ctx.fillText(ch, x, y);
					ctx.shadowOffsetX = 0;
					ctx.shadowOffsetY = 0;
					x += ctx.measureText(ch).width;
				}
			}
			x += 8
			console.log(`X position after rank string: ${x}`);
			ctx.fillStyle = "#FFFF55";
			
			ctx.shadowColor = chroma("#FFFF55").darken(3).hex();
			ctx.shadowBlur = 0;
			ctx.shadowOffsetX = 3;
			ctx.shadowOffsetY = 3;
			ctx.fillText(" has joined the server!", x, y);
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
			console.log("Rank string drawn successfully");
		} catch (err) {
			console.error("Error drawing rank string:", err);
		}
	}
	
    function makeRankStringShadow(str, rank, rankcolor, str2, x, y) {
        console.log(`Making rank string shadow: "${str}", rank: ${rank}`);
		let bigrankcolor;
		if (rank == "NONE") {
			bigrankcolor = chroma("#AAAAAA").darken(3).hex()
		} else if (rank == "VIP") {
            bigrankcolor = chroma("#55FF55").darken(3).hex()
		} else if (rank == "VIP+") {
			bigrankcolor = chroma("#AAAAAA").darken(3).hex()
		} else if (rank == "MVP") {
			bigrankcolor = chroma("#55FFFF").darken(3).hex()
		} else if (rank == "MVP+") {
			bigrankcolor = chroma("#55FFFF").darken(3).hex()
		} else if (rank == "YOUTUBER") {
			bigrankcolor = chroma("#55FFFF").darken(3).hex()
		} else if (rank == "GAME_MASTER") {
			bigrankcolor = chroma("#00AA00").darken(3).hex()
		} else if (rank == "ADMIN") {
			bigrankcolor = chroma("FF5555").darken(3).hex()
		} else if (rank == "MVP++") {
			bigrankcolor = chroma("#FFAA00").darken(3).hex()
		} else {
			bigrankcolor = bigrankcolor = chroma("FFFFFF").darken(3).hex()
		}
		
		try {
			for (var i = 0; i <= str.length; ++i) {
				var ch = str.charAt(i);
				if (ch == "+") {
					ctx.shadowColor = chroma(rankcolor).darken(3).hex();
					ctx.shadowBlur = 0;
					ctx.shadowOffsetX = 3;
					ctx.shadowOffsetY = 3;
					ctx.fillStyle = rankcolor;
					ctx.font = "50px RedHat";
					ctx.fillText(ch, x, y);
					ctx.shadowOffsetX = 0;
					ctx.shadowOffsetY = 0;
					x += ctx.measureText(ch).width;
				} else {
					ctx.shadowColor = chroma(bigrankcolor).darken(3).hex();
					ctx.shadowBlur = 0;
					ctx.shadowOffsetX = 3;
					ctx.shadowOffsetY = 3;
					ctx.fillStyle = bigrankcolor;
					ctx.font = "50px RedHat";
					ctx.fillText(ch, x, y);
					ctx.shadowOffsetX = 0;
					ctx.shadowOffsetY = 0;
					x += ctx.measureText(ch).width;
				}
			}
			console.log("Rank string shadow drawn successfully");
		} catch (err) {
			console.error("Error drawing rank string shadow:", err);
		}
	}
	
	function makeText(string, string2, x, y, color, color2, font) {
		console.log(`Making text: "${string}${string2}" at ${x},${y}`);
		try {
			ctx.fillStyle = color;
			ctx.font = "25px RedHat";
			ctx.shadowColor = chroma(color).darken(3).hex();
			ctx.shadowBlur = 0;
			ctx.shadowOffsetX = 3;
			ctx.shadowOffsetY = 3;
			ctx.fillText(string, x, y+2);
			x += ctx.measureText(string).width;
			ctx.fillStyle = color2;
			ctx.font = "22px RedHat";
			ctx.shadowColor = chroma(color2).darken(3).hex();
			ctx.fillText(string2, x, y);
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
			console.log("Text drawn successfully");
		} catch (err) {
			console.error("Error drawing text:", err);
		}
	}
	
	function makeText1(string, x, y, color, font, offset) {
		console.log(`Making text1: "${string}" at ${x},${y} with font ${font}`);
		try {
			ctx.fillStyle = color;
			ctx.font = font;
			ctx.shadowColor = chroma(color).darken(3).hex();
			ctx.shadowBlur = 0;
			ctx.shadowOffsetX = offset;
			ctx.shadowOffsetY = offset;
			ctx.fillText(string, x, y+2);
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
			console.log("Text1 drawn successfully");
		} catch (err) {
			console.error("Error drawing text1:", err);
		}
	}
	
	const created = moment(userobject.createdAt).format('LL');
	console.log(`Account created: ${created}`);
	
	try {
		makeText(
			"Discord:",
			`  ${usertag}`,
			30,
			200,
			colorDictionary.BLUE,
			"#FFFFFF"
		);
		
		makeText(
			"Guild:",
			`  ${guildname}`,
			30,
			240,
			colorDictionary.DARK_GREEN,
			tagcolor
		);
		
		makeText(
			"Level:",
			`  ${nwlevel}`,
			30,
			280,
			colorDictionary.GOLD,
			"#FFFFFF"
		);
		
		ctx.globalAlpha = 0.7;
		makeText1(
			"Discord account created on",
			30,
			400,
			colorDictionary.BLUE,
			"17px RedHat",
			3
		);
		
		makeText1(
			`${created} (${moment(userobject.createdAt).fromNow()})`,
			30,
			420,
			"#FFFFFF",
			"15px RedHat",
			2
		);
		
		ctx.globalAlpha = 1;
		makeText1(
			`Member #${commafy(count)}`,
			565,
			350,
			"#FFFFFF",
			"20px RedHat",
			3
		);
		
		console.log("Making final rank string");
		makeRankString(
			newtopstring,
			await getRank(api),
			rankcolor,
			newtopstring,
			30,
			80
		);
		
		console.log("Creating attachment");
		const attachment = new Discord.AttachmentBuilder(
			canvas.toBuffer(),
			"welcome.png"
		);
		console.log("Welcome image generated successfully");
		return attachment;
	} catch (err) {
		console.error("Error in final image composition:", err);
		// Return a fallback attachment or rethrow
		throw err;
	}
};

module.exports = generatewelcome;