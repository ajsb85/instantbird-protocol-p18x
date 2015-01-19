const EXPORTED_SYMBOLS = [
  "getEncodeType",
  "encodeMessage",
  "decodeMessage",
  "escapeMessage",
  "parseTime",
  "transTime",
  "phoneNumberCheck",
  "getAsUriParameters",
  "getCurrentTimeString"
];

function getAsUriParameters(obj) {
    var parts = [];
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]));
        }
    }
    return parts.join('&');
}

function phoneNumberCheck(number)
{
  return /^[\d#\*\+\(\)\-pe\?][\d#\*\(\)\-pe\?]{0,}$/.test(number);
}


/**
 * 获取当前时间.格式如：2012；01；02；12；33；44+800
 * @method getCurrentTimeString
 * @param {Date} theTime
 * @return {String}
 */
function getCurrentTimeString(theTime) {
	var time = "";
	var d = theTime ? theTime : new Date();
	time += (d.getFullYear() + "").substring(2) + ";";
	time += getTwoDigit((d.getMonth() + 1)) + ";" + getTwoDigit(d.getDate()) + ";" + getTwoDigit(d.getHours()) + ";"
			+ getTwoDigit(d.getMinutes()) + ";" + getTwoDigit(d.getSeconds()) + ";";

	if (d.getTimezoneOffset() < 0) {
		time += "+" + (0 - d.getTimezoneOffset() / 60);
	} else {
		time += (0 - d.getTimezoneOffset() / 60);
	}
	return time;
}

/**
 * 字符串长度不足两位，前面补零
 * @method getTwoDigit
 * @return {String}
 */
function getTwoDigit(num) {
	num += "";
	while (num.length < 2) {
		num = "0" + num;
	}
	return num;
}


// encode start
/**
 * GSM7编码表
 * @attribute {Array} GSM7_Table
 */
var GSM7_Table = new Array("0040","00A3","0024","00A5","00E8","00E9","00F9","00EC","00F2","00C7","000A","00D8",
		"00F8","000D","00C5","00E5","0394","005F","03A6","0393","039B","03A9","03A0","03A8",
	    "03A3","0398","039E","00A0","00C6","00E6","00DF","00C9","0020","0021","0022","0023",   
		"00A4","0025","0026","0027","0028","0029","002A","002B","002C","002D","002E","002F",
	   	"0030","0031","0032","0033","0034","0035","0036","0037","0038","0039","003A","003A",     
		"003B","003C","003D","003E","003F","00A1","0041","0042","0043","0044","0045","0046",
	    "0047","0048","0049","004A","004B","004C","004D","004E","004F","0050","0051","0052",	   
		"0053","0054","0055","0056","0057","0058","0059","005A","00C4","00D6","00D1","00DC",
	    "00A7","00BF","0061","0062","0063","0064","0065","0066","0067","0068","0069","006A",    
		"006B","006C","006D","006E","006F","0070","0071","0072","0073","0074","0075","0076",
	    "0077","0078","0079","007A","00E4","00F6","00F1","00FC","00E0","000C","005E","007B",
		"007D","005C","005B","007E","005D","007C","20AC");

/**
 * GSM7扩展编码表
 * @attribute {Array} GSM7_Table_Extend
 */
var GSM7_Table_Extend = new Array("007B","007D","005B","005D","007E","005C","20AC","007C");
/**
 * 获取编码类型
 * @method getEncodeType
 * @param {String} strMessage 待编码字符串
 * @return {String}
 */
function getEncodeType(strMessage) {
	var encodeType = "GSM7_default";
    if (!strMessage) return encodeType;
	for ( var i = 0; i < strMessage.length; i++) {
        var charCode = strMessage.charCodeAt(i).toString(16).toUpperCase();
		while (charCode.length != 4) {
			charCode = "0" + charCode;
		}
		if (GSM7_Table.indexOf(charCode) == -1) {
			encodeType = "UNICODE";
			break;
		}
	}
	return encodeType;
}

/**
 * unicode编码
 * @method encodeMessage
 * @param textString {String}
 * @return {String} 
 */
function encodeMessage(textString) {
	var haut = 0;
	var result = '';
    if (!textString) return result;
	for ( var i = 0; i < textString.length; i++) {
		var b = textString.charCodeAt(i);
		if (haut != 0) {
			if (0xDC00 <= b && b <= 0xDFFF) {
				result += dec2hex(0x10000 + ((haut - 0xD800) << 10) + (b - 0xDC00));
				haut = 0;
				continue;
			} else {
				haut = 0;
			}
		}
		if (0xD800 <= b && b <= 0xDBFF) {
			haut = b;
		} else {
			cp = dec2hex(b);
			while (cp.length < 4) {
				cp = '0' + cp;
			}
			result += cp;
		}
	}
	return result;
}
var specialChars = ['000D','000A','0009','0000'];
/**
 * unicode解码
 * @method decodeMessage
 * @param str
 * @return any 
 */
function decodeMessage(str) {
    if (!str) return "";
    return str.replace(/([A-Fa-f0-9]{1,4})/g, function (matchstr, parens) {
        specialChars.forEach(function(i,n){
            if(n == parens){
                return '';
            }
        });
        return hex2char(parens);
    });
}
function dec2hex(textString) {
	return (textString + 0).toString(16).toUpperCase();
}
function hex2char(hex) {
	var result = '';
	var n = parseInt(hex, 16);
	if (n <= 0xFFFF) {
		result += String.fromCharCode(n);
	} else if (n <= 0x10FFFF) {
		n -= 0x10000;
		result += String.fromCharCode(0xD800 | (n >> 10)) + String.fromCharCode(0xDC00 | (n & 0x3FF));
	}
	return result;
}

/**
 * 去除编码中的回车换行等特殊字符
 * @method escapeMessage
 * @param msg
 * @return any 
 */
function escapeMessage(msg) {
	//msg = msg.toUpperCase().replace(/000D|000A|0009|0000/g, "");
	return msg;
}
/**
 * 解析时间字符串
 * @method parseTime
 * @param date {String} 时间字符串
 * @return String
 * @example
 * "12;05;22;14;40;08"
 * OR
 * "12,05,22,14,40,08"
 * OR
 * "12;05;22;14;40;08;+8"
 * OR
 * "12,05,22,14,40,08;+8"
 */
function parseTime(date) {
	if(date.indexOf("+") > -1){
		date = date.substring(0, date.lastIndexOf(";"));
	}
	var dateArr;
	if(date.indexOf(",") > -1){
		dateArr = date.split(",");
	}else{
		dateArr = date.split(";");
	}
	if (dateArr.length == 0) {
		return "";
	} else {
		var time = dateArr[0] + "-" + dateArr[1] + "-" + dateArr[2] + " " + dateArr[3] + ":" + dateArr[4] + ":"
				+ dateArr[5];
		return time;
	}
}

function transTime(data){
    var dateArr = data.split(",");
    if (dateArr.length == 0 || ("," + data + ",").indexOf(",,") != -1) {
        return "";
    } else {
        var time = dateArr[0] + "-" + dateArr[1] + "-" + dateArr[2] + " " + dateArr[3] + ":" + dateArr[4] + ":"
            + dateArr[5];
        return time;
    }

}
// encode end