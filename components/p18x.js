/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
const {classes: Cc, interfaces: Ci, results: Cr, utils: Cu} = Components;

Cu.import("resource://gre/modules/Http.jsm");
Cu.import("resource://prpl-p18x/p18x-util.jsm");
Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");
XPCOMUtils.defineLazyGetter(this, "_", function ()
  l10nHelper("chrome://prpl-p18x/locale/messages.properties")
);
XPCOMUtils.defineLazyGetter(this, "_contacts", function ()
  l10nHelper("chrome://chat/locale/contacts.properties")
);
//initLogModule("p18x", this);
let lockObs = false;
let isTest = false;
let timeOutCounter = 0;
let maxTimeOutCounter = 2;
// These timeouts are in milliseconds..
const kConnectTimeout = 1 * 1000; // 1 sec.

function Conversation(aAccount, aPhoneNumber) {
  this._phoneNumber = aPhoneNumber;
  this._account = aAccount;
  this.buddy = aAccount.getBuddy(aPhoneNumber);
  this._init(aAccount);
}
Conversation.prototype = {
  __proto__: GenericConvIMPrototype,
  _account: null,
  _phoneNumber: null,
  _disconnected: false,
  _setDisconnected: function () {
    this._disconnected = true;
  },
  close: function () {
    this._account.removeConversation(this._phoneNumber);
    Services.obs.notifyObservers(this, "closing-conversation", false);
    Services.conversations.removeConversation(this);
  },
  unInit: function () {
    delete this._account;
    delete this._observers;
    delete this._disconnected;
    delete this._setDisconnected;
    delete this._phoneNumber;
    // this._account.removeConversation(this.name);
    // GenericConvIMPrototype.unInit.call(this);
  },

  responseSmsReport: function (status) {
/*  sms_delivery_report_1 = Message has been received.
    sms_delivery_report_2 = Message is not received.
    sms_delivery_report_3 = Message is sending. */
    if (status > 0)
      this.writeMessage("p18x", _("sms_delivery_report_" + status), {system: true});
    else
      this.writeMessage("p18x", _("send_fail_try_again"), {system: true, error: true});
  },

  getSMSReady: function () {

  },
  saveSMS: function () {

  },
  deleteAllMessages: function () {

  },
  checkDeleteStatus: function (data) {

  },
  deleteMessage: function () {

  },

  sendMsg: function (aMsg) {
    if (!phoneNumberCheck(this._phoneNumber)) {
      this.writeMessage("p18x", _("phone_number_invalid"),
                        {system: true, error: true, noLog: true});
      this.ERROR(_("phone_number_invalid") + ": " + this._phoneNumber);
      return;
    }
    this.writeMessage(this.account.alias !== "" ?
                        this.account.alias : this.account.name,
                      aMsg, {outgoing: true});
      let queryParams = {
        goformId: "SEND_SMS",
        notCallback: true,
        Number: this._phoneNumber,
        sms_time: getCurrentTimeString(),
        MessageBody: escapeMessage(encodeMessage(aMsg)),
        ID: -1,
        encode_type: getEncodeType(aMsg),
        isTest: isTest
      };
      this._account.setCmdProcess(queryParams, (function (aRequest) {
        if (aRequest.result == "success") {
          let timer = Cc["@mozilla.org/timer;1"]
                               .createInstance(Ci.nsITimer);
          timer.initWithCallback((function () {
            try {
              this._account.getSmsStatusInfo({
                smsCmd: 4,
                timer: timer
              }, (function (status) {
                if (status == 3 &&
                    this._account.getBool("sms_para_status_report")) {
                  this.responseSmsReport(status);
                }
                if (status != 3)
                  this.responseSmsReport(status);
              }).bind(this));
            } catch (e) {
              timer.cancel();
            }
          }).bind(this), 1000, timer.TYPE_REPEATING_SLACK);
        }else{
          this.writeMessage("p18x", aRequest.result,
                            {system: true, error: true});
        }
      }).bind(this));
  },

  get name() this._phoneNumber,
  get account() this._account.imAccount,
  get normalizedName() this._phoneNumber,
  get title() this._phoneNumber,
  get startDate() this._date
};

function AccountBuddy(aAccount, aBuddy, aTag, aPhoneNumber)
{
  this._init(aAccount, aBuddy, aTag, aPhoneNumber);
  //this._buddy = aBuddy;
}
AccountBuddy.prototype = {
  __proto__: GenericAccountBuddyPrototype,
  getTooltipInfo: function () {
    let tooltipInfo = [];
    if (this._pbm_email)
      tooltipInfo.push(new TooltipInfo(_("mail"), this._pbm_email));
    if (this._pbm_anr)
      tooltipInfo.push(new TooltipInfo(_("home_phone_number"), this._pbm_anr));
    if (this._pbm_anr1)
      tooltipInfo.push(new TooltipInfo(_("office_phone_number"),
                        this._pbm_anr1));
    if (this._pbm_group)
      switch (this._pbm_group) {
        case "common":
        case "family":
        case "friend":
        case "colleague":
          tooltipInfo.push(new TooltipInfo(_("group"),
                            _("group_" + this._pbm_group)));
        break;
        case "defaultGroup":
         tooltipInfo.push(new TooltipInfo(_("group"),
                          _contacts("defaultGroup")));
        break;
        default:
          tooltipInfo.push(new TooltipInfo(_("group"), this._pbm_group));
        break;
      }
    tooltipInfo.push(new TooltipInfo(_("save_location"),
                    _("save_location_" + this._pbm_location)));
    return new nsSimpleEnumerator(tooltipInfo);
  },
  remove: function () {
    this._account.removeBuddy(this, true)
  },
  // This removes the buddy locally, but keeps him on the device.
  removeLocal: function () this._account.removeBuddy(this, false),
  createConversation: function ()
    this._account.createConversation(this.userName),
}

function Account(aProtoInstance, aImAccount) {
  this._init(aProtoInstance, aImAccount);
  this._buddies = new Map();
  this._conversations = new Map();
}
Account.prototype = {
  __proto__: GenericAccountPrototype,
  // A Map holding the list of buddies associated with their usernames.
  _buddies: null,
  // A Map holding the list of open buddy conversations associated with the
  // username of the buddy.
  _conversations: null,
  _lan_ipaddr: null,
  _phoneNumber: null,
  _ajax: null,
  _connectTimer: null,
  get prefs() this._prefs ||
    (this._prefs = Services.prefs.getBranch("messenger.account." +
                                            this.imAccount.id + ".options.")),
  setBool: function (aName, aVal) {
    this.prefs.setBoolPref(aName, aVal);
    if (this.prplAccount)
      this.prplAccount.setBool(aName, aVal);
    if (this.connected)
      this.setSmsSetting();
  },
  setString: function (aName, aVal) {
    let str = Cc["@mozilla.org/supports-string;1"]
                .createInstance(Ci.nsISupportsString);
    str.data = aVal;
    this.prefs.setComplexValue(aName, Ci.nsISupportsString, str);
    if (this.prplAccount)
      this.prplAccount.setString(aName, aVal);
    if (this.connected)
      this.setSmsSetting();
  },
  connect: function () {
    Services.obs.addObserver(this, "account-connected", false);
    Services.obs.addObserver(this, "nsPref:changed", false);
    // Services.obs.addObserver(this, "account-added", false);
    // Services.obs.addObserver(this, "account-updated", false);
    // Services.obs.addObserver(this, "account-connecting", false);
    // Services.obs.addObserver(this, "account-connect-progress", false);
    // Services.obs.addObserver(this, "account-disconnected", false);
    // Services.obs.addObserver(this, "account-disconnecting", false);
    Services.obs.addObserver(this, "account-buddy-display-name-changed", false);
    Services.obs.addObserver(this, "contact-tag-added", false);
    Services.obs.addObserver(this, "contact-tag-removed", false);
    this.reportConnecting();
    let match =
      /^(?:([^"&'/:<>@]+)@)?([^@/<>'\"]+)(?:\/(.*))?$/.exec(this.name);
    if (!match)
      return null;
    this._lan_ipaddr = match[2].toLowerCase();
    this._phoneNumber = match[3];
    this._connectTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this._connectTimer
        .initWithCallback(this.timerUpdater.bind(this), kConnectTimeout,
                          this._connectTimer.TYPE_REPEATING_SLACK);
  },
  getCmdProcess: function (params, successCallback, abort) {
    if (this._ajax && abort) {
      this._ajax.abort();
    }
    let options = {
      postData: null,
      onLoad: null,
      onError: null,
      logger: {log: this.LOG.bind(this),
               debug: this.DEBUG.bind(this)}
    }
    let url = "http://" + this._lan_ipaddr + "/goform/goform_get_cmd_process?";
    url += getAsUriParameters(params);
    this._ajax = httpRequest(url, options);
    this._ajax.onload = function (aRequest) {
      successCallback(JSON.parse(aRequest.target.responseText));
    }
    this._ajax.onError = function (status) {
      this.ERROR(status);
    }
  },
  setCmdProcess: function (params, successCallback) {
    let options = {
      postData: getAsUriParameters(params),
      onLoad: null,
      onError: null,
      logger: {log: this.LOG.bind(this),
               debug: this.DEBUG.bind(this)}
    }
    let url = "http://" + this._lan_ipaddr + "/goform/goform_set_cmd_process";
    let xhr = httpRequest(url, options);
    xhr.onload = function (aRequest) {
      successCallback(JSON.parse(aRequest.target.responseText));
    }
    xhr.onError = function (status) {
      this.ERROR(status);
    }
  },
  timerUpdater: function () {
    timerQueryString = [
    "signalbar",
    "network_type",
    "network_provider",
    "ppp_status",
    "modem_main_state",
    "EX_SSID1",
    "ex_wifi_status",
    "EX_wifi_profile",
    "m_ssid_enable",
    "sms_unread_num",
    "sms_received_flag",
    "sts_received_flag",
    "RadioOff",
    "simcard_roam",
    "lan_ipaddr",
    "station_mac",
    "battery_charging",
    "battery_vol_percent",
    "battery_pers",
    "pin_status",
    "loginfo",
    /*"total_tx_bytes",
    "total_rx_bytes",
    "total_time",*/
    "realtime_tx_bytes",
    "realtime_rx_bytes",
    "realtime_time",
    "realtime_tx_thrpt",
    "realtime_rx_thrpt",
    "monthly_rx_bytes",
    "monthly_tx_bytes",
    "monthly_time",
    "date_month",
    "data_volume_limit_switch",
    "data_volume_limit_size",
    "data_volume_alert_percent",
    "data_volume_limit_unit",
    "roam_setting_option"];
      let queryParams = {
        cmd:timerQueryString.join(","),
        multi_data: 1,
        sms_received_flag_flag: 0,
        sts_received_flag_flag: 0,
        isTest: isTest
      };
      if (timeOutCounter >= maxTimeOutCounter) {
        this.gotDisconnected(Ci.prplIAccount.ERROR_NETWORK_ERROR,
                              _("ussd_timeout"));
        return;
      }
      timeOutCounter++;
      this.getCmdProcess(queryParams, (function (aRequest) {
          timeOutCounter = 0;
          let network_type = aRequest.network_type.toLowerCase();
          let modem_main_state = aRequest.modem_main_state;
            switch (modem_main_state) {
              case "modem_waitpin":
                this.gotDisconnected(Ci.prplIAccount.ERROR_OTHER_ERROR,
                                     _("sim_status_waitpin"));
                return;
              case "modem_waitpuk":
                this.gotDisconnected(Ci.prplIAccount.ERROR_OTHER_ERROR,
                                     _("sim_status_waitpuk"));
                return;
              case "modem_undetected":
              case "modem_sim_undetected":
                this.gotDisconnected(Ci.prplIAccount.ERROR_OTHER_ERROR,
                                     _("sim_status_undetected"));
                return;
              case "modem_destroy":
              case "modem_sim_destroy":
                this.gotDisconnected(Ci.prplIAccount.ERROR_OTHER_ERROR,
                                     _("sim_status_destroy"));
                return;
              case "modem_imsi_waitnck":
                this.gotDisconnected(Ci.prplIAccount.ERROR_OTHER_ERROR,
                                     _("sim_status_waitnck"));
                return;
            }
            switch (network_type.trim()) {
              case "limited service":
              case "limitedservice":
              case "limited_service":
                this.gotDisconnected(Ci.prplIAccount.ERROR_NETWORK_ERROR,
                                     _("network_type_limited_service"));
                return;
              case "no service":
              case "noservice":
              case "no_service":
                this.gotDisconnected(Ci.prplIAccount.ERROR_NETWORK_ERROR,
                                     _("network_type_no_service"));
                return;
            }
          if (!this.connected)
            this.reportConnected();
          if (aRequest.sts_received_flag > 0 &&
              this.getBool("sms_para_status_report"))
            this.getSMSDeliveryReport();
          if (aRequest.sms_unread_num > 0 || aRequest.sms_received_flag > 0)
            this.getNewMessages();
      }).bind(this), true);
  },

  getNewMessages: function () {
    let queryParams = {
      cmd: "sms_data_total",
      tags: 1,
      mem_store: 1,
      page: 0,
      data_per_page: 500,
      order_by: "order+by+id+desc",
      isAsc: true,
      isTest: isTest
    };
    let msgIds = [];
    this.getCmdProcess(queryParams, (function (aRequest) {
      let msgs = aRequest.messages.reverse();
      msgs.forEach( i => {
          this.receiveMessage(i.number,
                              decodeMessage(escapeMessage(i.content)));
          msgIds.push(i.id);
      }, this);
      this.setSmsRead(msgIds.join(";"));
    }).bind(this));
  },

  setSmsRead: function (msgIds) {
    if (msgIds.length > 0) {
      msgIds += ";";
      let queryParams = {
        isTest: isTest,
        goformId: "SET_MSG_READ",
        msg_id: msgIds,
        tag: 0
      };
      this.setCmdProcess(queryParams, function (aRequest) {
        if (aRequest.result == "success") {}
      });
    }
  },

/*     Services.obs.addObserver(this, "profile-after-change", false);
    Services.obs.addObserver(this, "contact-moved-in", false);
    Services.obs.addObserver(this, "contact-added", false);
    Services.obs.addObserver(this, "contact-removed", false);
    Services.obs.addObserver(this, "user-info-received", false);
    Services.obs.addObserver(this, "profile-before-change", false);
    Services.obs.addObserver(this, "display-name-changed", false);
    Services.obs.addObserver(this, "preferred-buddy-changed", false);
    Services.obs.addObserver(this, "account-buddy-availability-changed", false);
    Services.obs.addObserver(this, "account-buddy-status-changed", false);
    Services.obs.addObserver(this, "account-buddy-icon-changed", false);
    Services.obs.addObserver(this, "account-buddy-added", false);
    Services.obs.addObserver(this, "account-buddy-removed", false);   */

  leaks: function () {
    // Clear and delete the timers to avoid memory leaks.
    if (this._connectTimer) {
      this._connectTimer.cancel();
      delete this._connectTimer;
    }
    if (this._ajax) {
      timeOutCounter = 0;
      this._ajax.abort();
      delete this._ajax;
    }
  },

  gotDisconnected: function (aError = Ci.prplIAccount.NO_ERROR,
                              aErrorMessage = "") {
    this.leaks();
    this.reportDisconnecting(aError, aErrorMessage);
    this.reportDisconnected();
  },

  getSMSDeliveryReport: function () {
    let queryParams = {
      cmd: "sms_status_rpt_data",
      page: 0,
      data_per_page: 10,
      isTest: isTest
    };
    this.getCmdProcess(queryParams, (function (aRequest) {
      if (aRequest) {
          aRequest.messages.forEach( i => {
            if (i.content == 1)
              this.receiveSystemMessage(i.number,
                        _("sms_delivery_report_1") + " " + transTime(i.date));
          }, this);
      }else{

      }
    }).bind(this));
  },

  getSmsStatusInfo: function (obj, callback) {
    if (!this.connected)
      obj.timer.cancel();
    let queryParams = {
      cmd: "sms_cmd_status_info",
      sms_cmd: obj.smsCmd,
      isTest: isTest
    };
    this.getCmdProcess(queryParams, (function (aRequest) {
      if (aRequest) {
        obj.timer.cancel();
        callback(parseInt(aRequest.sms_cmd_status_result));
      }else{
        obj.timer.cancel();
        callback(-1);
      }
    }).bind(this));
  },

  receiveSystemMessage: function (aPhoneNumber, aMessage) {
    let conv;
    // Check if we have an existing converstaion open with this user. If not,
    // create one and add it to the list.
    if (!this._conversations.has(aPhoneNumber))
      conv = this.createConversation(aPhoneNumber);
    else
      conv = this._conversations.get(aPhoneNumber);

    conv.writeMessage(aPhoneNumber, aMessage, {system: true});
  },

  receiveMessage: function (aPhoneNumber, aMessage) {
    let conv;
    // Check if we have an existing converstaion open with this user. If not,
    // create one and add it to the list.
    if (!this._conversations.has(aPhoneNumber))
      conv = this.createConversation(aPhoneNumber);
    else
      conv = this._conversations.get(aPhoneNumber);

    conv.writeMessage(aPhoneNumber, aMessage, {incoming: true});
  },

  disconnect: function (aSilent) {
   if (!this.imAccount || this.disconnected)
       return;

    this.reportDisconnecting(Ci.prplIAccount.NO_ERROR, "");
    for (let buddy of this._buddies)
      buddy[1].setStatus(Ci.imIStatusInfo.STATUS_UNKNOWN, "");

    this.leaks();
    this.removeObs();
    this.reportDisconnected();
  },

  removeObs: function () {
    Services.obs.removeObserver(this, "contact-tag-added");
    Services.obs.removeObserver(this, "contact-tag-removed");
    Services.obs.removeObserver(this, "account-buddy-display-name-changed");
    Services.obs.removeObserver(this, "account-connected");
  },

  get canJoinChat() false,

  remove: function () {
    for each(let conv in this._conversations)
      conv.close();
    delete this._conversations;
    for (let buddy of this._buddies)
      buddy[1].removeLocal(); // buddy[1] is the actual object.
  },

  unInit: function () {
    this.leaks();
    delete this._buddies;
    delete this._conversations;
    delete this._lan_ipaddr;
    delete this._ajax;
    delete this._connectTimer;
    if (this.connected)
      this.removeObs();
  },

  createConversation: function (aPhoneNumber) {
    let conv = new Conversation(this, aPhoneNumber);
    this._conversations.set(aPhoneNumber, conv);
    return conv;
  },

  removeConversation: function (aPhoneNumber) {
    if (this._conversations.has(aPhoneNumber))
      this._conversations.delete(aPhoneNumber);
  },

  setSmsSetting: function () {
    let queryParams = {
      goformId: "SET_MESSAGE_CENTER",
      save_time: this.getString("sms_para_validity_period"),
      MessageCenter: this.getString("sms_para_sca"),
      status_save: this.getBool("sms_para_status_report") ? 1 : 0,
      save_location: "native",
      notCallback: true,
      isTest: isTest
    };
    this.setCmdProcess(queryParams, (function (aRequest) {
      if (aRequest.result == "success") {
        let timer = Cc["@mozilla.org/timer;1"]
                             .createInstance(Ci.nsITimer);
        timer.initWithCallback((function () {
          try {
            this.getSmsStatusInfo({
              smsCmd: 3,
              timer: timer
            }, (function (status) {
              if (status == 3)
                this.LOG("success");
              else
                this.WARN(status);
            }).bind(this));
          } catch (e) {
            timer.cancel();
            this.ERROR(e);
          }
        }).bind(this), 1000, timer.TYPE_REPEATING_SLACK);
      }else{
        this.ERROR(_("error_info"));
      }
    }).bind(this));
  },

  getSmsSetting: function () {
    let queryParams = {
      cmd: "sms_parameter_info",
      isTest: isTest
    };
    this.getCmdProcess(queryParams, (function (aRequest) {
      let options = {};
      options.validity = Cc["@mozilla.org/supports-string;1"]
              .createInstance(Ci.nsISupportsString);
      options.centerNumber = Cc["@mozilla.org/supports-string;1"]
              .createInstance(Ci.nsISupportsString);
      options.centerNumber.data = aRequest.sms_para_sca;
      options.memStroe = aRequest.sms_para_mem_store;
      options.deliveryReport =
                parseInt(aRequest.sms_para_status_report) == 1 ? true : false;
      switch (parseInt(aRequest.sms_para_validity_period)) {
        case 143:
          options.validity.data = "twelve_hours";
          break;
        case 167:
          options.validity.data = "one_day";
          break;
        case 173:
          options.validity.data = "one_week";
          break;
        case 255:
          options.validity.data = "largest";
          break;
        default:
          options.validity.data = "twelve_hours";
          break;
      }
/*     let setSmsSetting = false;
    if (this.getBool("sms_para_status_report")!=options.deliveryReport)
      if (this.prefs.prefHasUserValue("sms_para_status_report"))
        setSmsSetting = true;
    else */
      this.prefs.setBoolPref("sms_para_status_report", options.deliveryReport);

    this.prefs.setComplexValue("sms_para_validity_period",
                                    Ci.nsISupportsString, options.validity);
    this.prefs.setComplexValue("sms_para_sca",
                                    Ci.nsISupportsString, options.centerNumber);
    /*if (this.prplAccount) {
      this.prplAccount.setString(aName, aVal);
      this.prplAccount.setBool(aName, aVal);
    }*/
    }).bind(this));
  },

  addBuddiesFromDevice: function () {
    lockObs = true;
    let queryParams = {
      cmd: "pbm_data_total",
      mem_store: 2,
      page: 0,
      data_per_page: 500,
      orderBy: "name",
      isAsc: true,
      isTest: isTest
    };
    this.getCmdProcess(queryParams, (function (aRequest) {
      let books = [];
      let buddy;
      let aTag;
      aRequest.pbm_data.forEach( i => {
        if (this._buddies.has(i.pbm_number)) {
          buddy = this.getBuddy(i.pbm_number);
        }
        else {
          if (i.pbm_group)
            switch (i.pbm_group) {
              case "common":
              case "family":
              case "friend":
              case "colleague":
                aTag = Services.tags.createTag(_("group_" + i.pbm_group));
              break;
              case "defaultGroup":
                aTag = Services.tags.defaultTag;
              break;
              default:
                aTag = Services.tags.createTag(i.pbm_group);
              break;
            }
          else
            aTag = Services.tags.createTag(_("save_location_0"));
          buddy = new AccountBuddy(this, null, aTag, i.pbm_number);
          //buddy.serverAlias = decodeMessage(i.pbm_name);
          Services.contacts.accountBuddyAdded(buddy);
          //Services.obs.notifyObservers(buddy, "added", null);
          //buddy._notifyObservers("added", buddy)
          //Services.obs.addObserver(this, "account-buddy-added", false);
        }
        buddy.serverAlias = decodeMessage(i.pbm_name);
        buddy._pbm_email = decodeMessage(i.pbm_email);
        buddy._pbm_id = i.pbm_id;
        buddy._pbm_anr = i.pbm_anr;
        buddy._pbm_anr1 = i.pbm_anr1;
        buddy._pbm_location = parseInt(i.pbm_location);
        buddy._pbm_group = i.pbm_group;
        this._buddies.set(i.pbm_number, buddy);
        buddy.setStatus(Ci.imIStatusInfo.STATUS_MOBILE, "");
      }, this);
      lockObs = false;
      this.removeUnknownBuddies();
    }).bind(this));
  },

  addBuddy: function (aTag, aPhoneNumber) {
    if (!phoneNumberCheck(aPhoneNumber)) {
      let conv;
      // Check if we have an existing converstaion open with this user.
      if (this._conversations.has(aPhoneNumber)) {
        conv = this._conversations.get(aPhoneNumber);
        conv.writeMessage(aPhoneNumber, _("phonenumber_check"),
                          {system: true, noLog: true});
      }else
        this.ERROR(_("phonenumber_check"));
      return;
    }
    let buddy = new AccountBuddy(this, null, aTag, aPhoneNumber);
    buddy._pbm_email = "";
    buddy._pbm_id = -1;
    buddy._pbm_anr = "";
    buddy._pbm_anr1 = "";
    buddy._pbm_location = aTag.name==_("save_location_0") ? 0 : 1;
    buddy._pbm_group = this.getGroupByL10N(aTag.name) != null ?
      this.getGroupByL10N(aTag.name) : this.getLocalGroupByL10N(aTag.name);
    buddy.serverAlias = aPhoneNumber;

    this.addBuddyToPBM(buddy, (function (result) {
      if (result == "success")
        this.addBuddiesFromDevice();
    }).bind(this));
/*  this._buddies.set(buddy.userName, buddy);
    Services.contacts.accountBuddyAdded(buddy);
    buddy.setStatus(Ci.imIStatusInfo.STATUS_MOBILE, ""); */
  },

  addBuddyToPBM: function (aBuddy, callback) {
    let queryParams = {
      goformId: "PBM_CONTACT_ADD",
      notCallback: true,
      location: aBuddy._pbm_location,
      name: encodeMessage(aBuddy.serverAlias),
      mobilephone_num: aBuddy.userName,
      isTest: isTest
    };

    switch (aBuddy._pbm_location) {
    case 0:
      queryParams.edit_index = aBuddy._pbm_id;
    break;
    case 1:
      queryParams.add_index_pc = aBuddy._pbm_id;
      queryParams.homephone_num = aBuddy._pbm_anr;
      queryParams.officephone_num = aBuddy._pbm_anr1;
      queryParams.email = encodeMessage(aBuddy._pbm_email);
      queryParams.groupchoose = aBuddy._pbm_group;
    break;
    }

    this.setCmdProcess(queryParams, (function (aRequest) {
      if (callback)
        callback(aRequest.result);
    }).bind(this));
  },

  hasBuddy: function (aPhoneNumber) {
    return this._buddies.has(aPhoneNumber);
  },

  // Called when a user removes a contact from within Instantbird.
  removeBuddy: function (aBuddy, aRemoveFromDevice) {
    if (aRemoveFromDevice) {
      let queryParams = {
        goformId: "PBM_CONTACT_DEL",
        notCallback: true,
        del_option: "delete_num",
        delete_id: aBuddy._pbm_id,
        isTest: isTest
      };
      this.setCmdProcess(queryParams, (function (aRequest) {
        if (aRequest.result == "success") {
          this._buddies.delete(aBuddy.userName);
          Services.contacts.accountBuddyRemoved(aBuddy);
        }
      }).bind(this));
    }else{
      this._buddies.delete(aBuddy.userName);
      Services.contacts.accountBuddyRemoved(aBuddy);
    }
/*     if (this._conversations.has(aBuddy.userName))
      this._conversations.get(aBuddy.userName).close(); */
  },

  loadBuddy: function (aBuddy, aTag) {
    let buddy = new AccountBuddy(this, aBuddy, aTag);
    this._buddies.set(buddy.userName, buddy);
    return buddy;
  },

  getBuddy: function (aPhoneNumber) {
    if (this._buddies.has(aPhoneNumber))
      return this._buddies.get(aPhoneNumber);
    return null;
  },

  removeUnknownBuddies: function () {
    let onlineBuddies = [];
    for (let buddy of this._buddies) {
      if (buddy[1].statusType != Ci.imIStatusInfo.STATUS_MOBILE)
        Services.contacts.accountBuddyRemoved(buddy[1]);
      //Ci.imIStatusInfo.STATUS_UNKNOWN
    }
  },

  getGroupByL10N: function (aGroup) {
    switch (aGroup) {
      case _("group_common"):
      return "common";
      case _("group_family"):
      return "family";
      case _("group_friend"):
      return "friend";
      case _("group_colleague"):
      return "colleague";
      default:
      return null;
    }
  },

  getLocalGroupByL10N: function (aGroup) {
    switch (aGroup) {
      case _contacts("defaultGroup"):
      return "defaultGroup";
      default:
      return aGroup;
    }
  },

  observe: function (aSubject, aTopic, aData) {
    if (aTopic == "contact-tag-added" || aTopic == "contact-tag-removed") {
      let aBuddy = aSubject.preferredBuddy.preferredAccountBuddy;
      if (aBuddy.account.name == this.name &&
          aBuddy.account.protocol.id == this.protocol.id) {
        let group_counter = 0;
        let pbm_location = 0;
        let pbm_group = "";
        aSubject.getTags().map(t => t.name).forEach( group => {
          if (this.getGroupByL10N(group)) {
            group_counter++;
            pbm_location = 1;
            pbm_group = this.getGroupByL10N(group);
          }
          if (group == _("save_location_0")) {
            group_counter++;
            pbm_location = 0;
            pbm_group = "";
          }
        }, this);
        if (group_counter == 1) {
          let buddy = this.getBuddy(aBuddy.userName);
          buddy._pbm_group = pbm_group;
          buddy._pbm_location = pbm_location;
          this.addBuddyToPBM(buddy);
        }
        if (group_counter == 0) {
          let buddy = this.getBuddy(aBuddy.userName);
          buddy._pbm_group = "";
          //"ToDo: Remove from PBM."
        }
      }
    }
    if (aTopic == "account-connected") {
      if (aSubject.name == this.name &&
          aSubject.protocol.id == this.protocol.id) {
        this.addBuddiesFromDevice();
        this.getSmsSetting();
      }
    }
    if (aTopic == "account-buddy-display-name-changed") {
      if (aSubject.account.name == this.name &&
          aSubject.account.protocol.id == this.protocol.id) {
        if (!lockObs) {
          if (aSubject.serverAlias.length > 15) {
            this.ERROR(_("maxlength"));
          }else{
            this.addBuddyToPBM(this.getBuddy(aSubject.userName));
          }
        }
      }
    }
  }
};

function p18x() {
  this.registerCommands();
}
p18x.prototype = {
  __proto__: GenericProtocolPrototype,
  get name() "P18X",
  get iconBaseURI() "chrome://prpl-p18x/skin/",
  get noPassword() true,
  get registerNoScreenName() true,
  get imagesInIM() false,
  isAway: false,
  options: {
    "sms_para_sca": {label: _("center_number") + " *",
                      default: _("auto_select")},
    "sms_para_status_report": {label: _("delivery_report"), default: true},
    "sms_para_validity_period": {label: _("sms_validity"),  default: "largest",
             listValues: {"twelve_hours": _("sms_validity_twelve_hours"),
                          "one_day": _("sms_validity_one_day"),
                          "one_week": _("sms_validity_one_week"),
                          "largest": _("sms_validity_largest")}},
  },
  commands: [
    {
      name: "email",
      get helpString() "help",
      run: function (aMsg, aConv) {
        let conv = aConv.wrappedJSObject;
        let buddy = conv.buddy;
        if (parseInt(buddy._pbm_location) == 1) {
          buddy._pbm_email = aMsg;
          conv._account._buddies.set(buddy.userName, buddy);
          conv._account.addBuddyToPBM(buddy, function (result) {
            conv.writeMessage("p18x", _(result + "_info"),
                              {system: true, noLog: true});
          });
        }else{
          conv.writeMessage("p18x", _("sim_full"),
                            {system: true, noLog: true});
        }
        return true;
      }
    },
    {
      name: "homephone",
      get helpString() "help",
      run: function (aMsg, aConv) {
        let conv = aConv.wrappedJSObject;
        let buddy = conv.buddy;
        if (parseInt(buddy._pbm_location) == 1) {
          buddy._pbm_anr = aMsg;
          conv._account._buddies.set(buddy.userName, buddy);
          conv._account.addBuddyToPBM(buddy, function (result) {
            conv.writeMessage("p18x", _(result + "_info"),
                              {system: true, noLog: true});
          });
        }else{
          conv.writeMessage("p18x", _("sim_full"),
                            {system: true, noLog: true});
        }
        return true;
      }
    },
    {
      name: "officephone",
      get helpString() "help",
      run: function (aMsg, aConv) {
        let conv = aConv.wrappedJSObject;
        let buddy = conv.buddy;
        if (parseInt(buddy._pbm_location) == 1) {
          buddy._pbm_anr1 = aMsg;
          conv._account._buddies.set(buddy.userName, buddy);
          conv._account.addBuddyToPBM(buddy, function (result) {
            conv.writeMessage("p18x", _(result + "_info"),
                              {system: true, noLog: true});
          });
        }else{
          conv.writeMessage("p18x", _("sim_full"),
                            {system: true, noLog: true});
        }
        return true;
      },
    }
  ],
  usernameSplits: [
    {label: _("ip_address"), separator: "@", defaultValue: "192.168.0.1",
     reverse: true}
  ],
  get usernameEmptyText() "Phone number",
  accountExists: function (aName) {
      let aNameSplit =
      /^(?:([^"&'/:<>@]+)@)?([^@/<>'\"]+)(?:\/(.*))?$/.exec(aName);
      if (!aNameSplit)
        return false;
    let accounts = Services.accounts.getAccounts()
    while (accounts.hasMoreElements()) {
      let account = accounts.getNext().QueryInterface(Ci.prplIAccount);
/*       if (aName==account.name)
        return true; */
      if (account.protocol.id != this.getAccount().protocol.id)
          return false;
      let usernameSplit =
        /^(?:([^"&'/:<>@]+)@)?([^@/<>'\"]+)(?:\/(.*))?$/.exec(account.name);
      if (!usernameSplit)
        return false;
      if (usernameSplit[2].toLowerCase() == aNameSplit[2].toLowerCase())
        return true;
    }
    return false;
  },
  getAccount: function (aImAccount) new Account(this, aImAccount),
  classID: Components.ID("{56211440-9aa4-11e4-bd06-0800200c9a66}"),
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([p18x]);
