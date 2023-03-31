/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2021 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
					http://zotero.org
	
	This file is part of Zotero.
	
	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
	
	***** END LICENSE BLOCK *****
*/

(function() {

// Various Utility functions related to Zotero, API, Translation Item formats
// and their conversion or field access.

    var Utilities_Item = {

	PARTICLE_GIVEN_REGEXP: /^([^ ]+(?:\u02bb |\u2019 | |\' ) *)(.+)$/,
	PARTICLE_FAMILY_REGEXP: /^([^ ]+(?:\-|\u02bb|\u2019| |\') *)(.+)$/,
	
	/**
	 * Tests if an item type exists
	 *
	 * @param {String} type Item type
	 * @type Boolean
	 */
	itemTypeExists: function(type) {
		return !!Zotero.ItemTypes.getID(type);
	},

	/**
	 * Converts an item from toArray() format to citeproc-js JSON
	 * @param {Zotero.Item} zoteroItem
	 * @return {Object|Promise<Object>} A CSL item, or a promise for a CSL item if a Zotero.Item
	 *     is passed
	 */
	/**
	* Helper function for pre-factoring creator names
	*/
	"creatorConvItemToCSLJSON":function(nameObj, creator) {
		if (creator.lastName || creator.firstName) {
			nameObj.family = creator.lastName || '';
			nameObj.given = creator.firstName || '';
				
			// Parse name particles
			// Replicate citeproc-js logic for what should be parsed so we don't
			// break current behavior.
			if (nameObj.family && nameObj.given) {
				// Don't parse if last name is quoted
				if (nameObj.family.length > 1
					&& nameObj.family.charAt(0) == '"'
					&& nameObj.family.charAt(nameObj.family.length - 1) == '"'
				   ) {
					nameObj.family = nameObj.family.substr(1, nameObj.family.length - 2);
				} else {
					Zotero.CiteProc.CSL.parseParticles(nameObj, true);
				}
			} else if (creator.lastName) {
				nameObj.literal = creator.lastName;
			}
			//if (Zotero.Prefs.get('csl.enableInstitutionFormatting')) {
			//	if (creator.fieldMode) {
			//		nameObj.isInstitution = fieldMode;
			//	}
			//}
		} else if (creator.name) {
			nameObj.literal = creator.name;
			//nameObj.family = creator.name;
			//nameObj.given = '';
			//nameObj.isInstitution = 1;
		}
	},

	/**
	 * Converts an item from toArray() format to citeproc-js JSON
	 * @param {Zotero.Item} zoteroItem
	 * @return {Object|Promise<Object>} A CSL item, or a promise for a CSL item if a Zotero.Item
	 *     is passed
	 */
	"itemToCSLJSON":function(zoteroItem, portableJSON, includeRelations) {
		if (!Zotero.Utilities.Internal._mapsInitialized) Zotero.Utilities.Internal.initMaps();
		// If a Zotero.Item was passed, convert it to the proper format (skipping child items) and
		// call this function again with that object
		//
		// (Zotero.Item won't be defined in translation-server)
		if (typeof Zotero.Item !== 'undefined' && zoteroItem instanceof Zotero.Item) {
			return Utilities_Item.itemToCSLJSON(
				Zotero.Utilities.Internal.itemToExportFormat(zoteroItem, false, true, true),
				portableJSON,
				includeRelations
			);
		}
		
		var originalType = zoteroItem.itemType;
		var originalItemTypeID = Zotero.ItemTypes.getID(originalType);
		
		if (portableJSON) {
			// Normalize date format to something spartan and unambiguous
			for (var field in zoteroItem) {
				if (Zotero.Utilities.isDate(field) && Zotero.Date.isMultipart(zoteroItem[field])) {
					zoteroItem[field] = Zotero.Date.multipartToSQL(zoteroItem[field]);
				}
			}
			zoteroItem = Zotero.Jurism.SyncRecode.encode(zoteroItem);
		}


		var cslType = Zotero.Schema.CSL_TYPE_MAPPINGS[zoteroItem.itemType];
		
		if (!cslType) {
			throw new Error('Unexpected Zotero Item type "' + zoteroItem.itemType + '"');
		}
		
		var itemTypeID = Zotero.ItemTypes.getID(zoteroItem.itemType);

		// Juris-M: used in FORCE FIELDS below
		var itemType = zoteroItem.itemType;

		var cslItem = {
			'id':zoteroItem.uri,
			'type':cslType
		};
		
		if (!portableJSON) {
			cslItem.multi = {
				'main':{},
				'_keys':{}
			}
		};

		// ??? Is this EVER useful?
		//if (!portableJSON) {
		//	if (!zoteroItem.libraryID) {
		//		cslItem.system_id = "0_" + zoteroItem.key;
		//	} else {
		//		cslItem.system_id = zoteroItem.libraryID + "_" + zoteroItem.key;
		//	}
		//}
		
		cslItem.id = zoteroItem.id;

		// get all text variables (there must be a better way)
		for(var variable in Zotero.Schema.CSL_TEXT_MAPPINGS) {
			if (variable === "shortTitle") continue; // read both title-short and shortTitle, but write only title-short
			var fields = Zotero.Schema.CSL_TEXT_MAPPINGS[variable];
			for(var i=0, n=fields.length; i<n; i++) {
				var field = fields[i],
					baseFieldName,
					value = null; // So we will try shortTitle on both iterations.
				
				if(zoteroItem[field]) {
					baseFieldName = field;
					value = zoteroItem[field];
				} else {
					if (field == 'versionNumber') field = 'version'; // Until https://github.com/zotero/zotero/issues/670
					var fieldID = Zotero.ItemFields.getID(field),
						typeFieldID;
					if(fieldID
						&& (typeFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(originalItemTypeID, fieldID))
					) {
						baseFieldName = Zotero.ItemFields.getName(typeFieldID);
						value = zoteroItem[baseFieldName];
					}
				}

				if (!value) continue;
				
				if (typeof value == 'string') {
					if (field == 'ISBN') {
						// Only use the first ISBN in CSL JSON
						var isbn = value.match(/^(?:97[89]-?)?(?:\d-?){9}[\dx](?!-)\b/i);
						if (isbn) value = isbn[0];
					}
					else if (field == 'jurisdiction') {
						var m = value.match(/^([0-9]{3})/);
						if (m) {
							var offset = parseInt(m[1], 10);
							value = value.slice(3, (offset + 3));
						}
					}
					else if (field == 'extra') {
						value = Zotero.Cite.extraToCSL(value);
					}
					
					// Strip enclosing quotes
					if(value.charAt(0) == '"' && value.indexOf('"', 1) == value.length - 1) {
						value = value.substring(1, value.length-1);
					}
					cslItem[variable] = value;

					if (!portableJSON) {
						if (zoteroItem.multi && zoteroItem.multi.main[baseFieldName]) {
							cslItem.multi.main[variable] = zoteroItem.multi.main[baseFieldName]
						}
						if (zoteroItem.multi && zoteroItem.multi._keys[baseFieldName]) {
							cslItem.multi._keys[variable] = {};
							for (var langTag in zoteroItem.multi._keys[baseFieldName]) {
								cslItem.multi._keys[variable][langTag] = zoteroItem.multi._keys[baseFieldName][langTag];
							}
						}
					}

					break;
				}
			}
		}
		
		// separate name variables
		if (zoteroItem.itemType != "attachment" && zoteroItem.itemType != "note") {
			var author = Zotero.CreatorTypes.getName(Zotero.CreatorTypes.getPrimaryIDForType(itemTypeID));
			var creators = zoteroItem.creators;
			for(var i=0; creators && i<creators.length; i++) {
				var creator = creators[i];
				var creatorType = creator.creatorType;
				if(creatorType == author) {
					creatorType = "author";
				} else {
					creatorType = Zotero.Schema.CSL_NAME_MAPPINGS[creatorType];
				}
				if(!creatorType) continue;

				if (zoteroItem.itemType === "videoRecording") {
					creatorType = "director";
				}

				var nameObj = {};
				Utilities_Item.creatorConvItemToCSLJSON(nameObj, creator);
				
				if (!portableJSON) {
					nameObj.multi = {};
					nameObj.multi._key = {};
					if (creator.multi.main) {
						nameObj.multi.main = creator.multi.main;
					}
					for (var langTag in creator.multi._key) {
						nameObj.multi._key[langTag] = {};
						Utilities_Item.creatorConvItemToCSLJSON(nameObj.multi._key[langTag], creator.multi._key[langTag]);
					}
				} else if (creator.name) {
					nameObj = {'literal': creator.name};
				}
				
				if(cslItem[creatorType]) {
					cslItem[creatorType].push(nameObj);
				} else {
					cslItem[creatorType] = [nameObj];
				}
			}
		}
		
		// get date variables
		for(var variable in Zotero.Schema.CSL_DATE_MAPPINGS) {
			for (var i=0,ilen=Zotero.Schema.CSL_DATE_MAPPINGS[variable].length;i<ilen;i++) {
				var zVar = Zotero.Schema.CSL_DATE_MAPPINGS[variable][i];
				var date = zoteroItem[zVar];
				if (!date) {
					var typeSpecificFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(itemTypeID, zVar);
					if (typeSpecificFieldID) {
						date = zoteroItem[Zotero.ItemFields.getName(typeSpecificFieldID)];
						if (date) break;
					}
				}
				if (date) break;
			}
			
			if(date) {
				// Convert UTC timestamp to local timestamp for access date
				if (Zotero.Schema.CSL_DATE_MAPPINGS[variable] == 'accessDate' && !Zotero.Date.isSQLDate(date)) {
					// Accept ISO date
					if (Zotero.Date.isISODate(date)) {
						let d = Zotero.Date.isoToDate(date);
						date = Zotero.Date.dateToSQL(d, true);
					}
					let localDate = Zotero.Date.sqlToDate(date, true);
					date = Zotero.Date.dateToSQL(localDate);
				}
				if (Zotero.Prefs.get('hackUseCiteprocJsDateParser')) {
					var country = Zotero.locale ? Zotero.locale.substr(3) : "US";
					if(variable === "accessed" ||
					   (country == "US" ||	// The United States
						country == "FM" ||	// The Federated States of Micronesia
						country == "PW" ||	// Palau
						country == "PH")) {	// The Philippines
						Zotero.DateParser.setOrderMonthDay();
					} else {
						Zotero.DateParser.setOrderDayMonth();
					}
					cslItem[variable] = Zotero.DateParser.parseDateToArray(Zotero.Date.multipartToStr(date));
				} else {
					var dateObj = Zotero.Date.strToDate(date);
					// otherwise, use date-parts
					var dateParts = [];
					if(dateObj.year) {
						// add year, month, and day, if they exist
						dateParts.push(dateObj.year);
						if(dateObj.month !== undefined) {
							// strToDate() returns a JS-style 0-indexed month, so we add 1 to it
							dateParts.push(dateObj.month+1);
							if(dateObj.day) {
								dateParts.push(dateObj.day);
							}
						}
						cslItem[variable] = {"date-parts":[dateParts]};
						
						// if no month, use season as month
						if(dateObj.part && dateObj.month === undefined) {
							cslItem[variable].season = dateObj.part;
						} else {
							// if no year, pass date literally
							cslItem[variable] = {"literal":date};
						}
					}
				}
			}
		}
		
		// Force Fields
		if (Zotero.Utilities.Internal.CSL_FORCE_FIELD_CONTENT[itemType]) {
			// The only variable force is CSL "genre", which should have the same name
			// on both sides.
			if (zoteroItem[variable]) {
				cslItem[variable] = zoteroItem[variable];
			} else {
				for (var variable in Zotero.Utilities.Internal.CSL_FORCE_FIELD_CONTENT[itemType]) {
					cslItem[variable] = Zotero.Utilities.Internal.CSL_FORCE_FIELD_CONTENT[itemType][variable];
				}
			}
		}
		
		// Force remap
		if (Zotero.Utilities.Internal.CSL_FORCE_REMAP[itemType]) {
			for (var variable in Zotero.Utilities.Internal.CSL_FORCE_REMAP[itemType]) {
				cslItem[Zotero.Utilities.Internal.CSL_FORCE_REMAP[itemType][variable]] = cslItem[variable];
				delete cslItem[variable];
			}
		}
		
		// Special mapping for note title
		if (zoteroItem.itemType == 'note' && zoteroItem.note) {
			cslItem.title = Zotero.Notes.noteToTitle(zoteroItem.note);
		}

		if (includeRelations) {
			cslItem.seeAlso = zoteroItem.seeAlso;
		}
		//this._cache[zoteroItem.id] = cslItem;
		return cslItem;
	},

    /**
     * Converts CSL type to Zotero type, accounting for extended
     * type mapping in Juris-M
     */
    "getZoteroTypeFromCslType": function(cslItem, strict) {
		if (!Zotero.Utilities.Internal._mapsInitialized) Zotero.Utilities.Internal.initMaps();
		
		// Some special cases to help us map item types correctly
		// This ensures that we don't lose data on import. The fields
		// we check are incompatible with the alternative item types
        var zoteroType = null;
		if (cslItem.type == 'book') {
			zoteroType = 'book';
			if (cslItem.version) {
				zoteroType = 'computerProgram';
			}
		} else if (cslItem.type == 'motion_picture') {
			zoteroType = 'film';
			if (cslItem['collection-title'] || cslItem['publisher-place']
				|| cslItem['event-place'] || cslItem.volume
				|| cslItem['number-of-volumes'] || cslItem.ISBN
			) {
				zoteroType = 'videoRecording';
			}
		} else if (cslItem.type === 'personal_communication') {
			zoteroType = 'letter';
			if (cslItem.genre === 'email') {
				zoteroType = 'email';
			} else if (cslItem.genre === 'instant message') {
				zoteroType = 'instantMessage';
			}
		} else if (cslItem.type === 'broadcast') {
			if (cslItem.genre === 'radio broadcast') {
				zoteroType = 'radioBroadcast';
			} else if (cslItem.genre == 'podcast') {
				zoteroType = 'podcast';
			} else {
				zoteroType = 'tvBroadcast';
			}
		}
		else if (cslItem.type == 'bill' && (cslItem.publisher || cslItem['number-of-volumes'])) {
			zoteroType = 'hearing';
		}
		else if (cslItem.type == 'broadcast'
				&& (cslItem['archive']
					|| cslItem['archive_location']
					|| cslItem['container-title']
					|| cslItem['event-place']
					|| cslItem['publisher']
					|| cslItem['publisher-place']
					|| cslItem['source'])) {
			zoteroType = 'tvBroadcast';
		}
		else if (cslItem.type == 'book' && cslItem.version) {
			zoteroType = 'computerProgram';
		}
		else if (cslItem.type == 'song' && cslItem.number) {
			zoteroType = 'podcast';
		}
		else if (cslItem.type == 'motion_picture'
				&& (cslItem['collection-title'] || cslItem['publisher-place']
					|| cslItem['event-place'] || cslItem.volume
					|| cslItem['number-of-volumes'] || cslItem.ISBN)) {
			zoteroType = 'videoRecording';
		}
		else if (Zotero.Schema.CSL_TYPE_MAPPINGS_REVERSE[cslItem.type]) {
			zoteroType = Zotero.Schema.CSL_TYPE_MAPPINGS_REVERSE[cslItem.type][0];
		}
		else if (!strict) {
			Zotero.debug(`Unknown CSL type '${cslItem.type}' -- using 'document'`, 2);
			zoteroType = "document";
		}
		
        return zoteroType;
    },		
	
    "getValidCslFields": function (cslItem) {
		if (!Zotero.Utilities.Internal._mapsInitialized) Zotero.Utilities.Internal.initMaps();
        var zoteroType = Utilities_Item.getZoteroTypeFromCslType(cslItem);
        var zoteroTypeID = Zotero.ItemTypes.getID(zoteroType);
        var zoteroFields = Zotero.ItemFields.getItemTypeFields(zoteroTypeID);
        var validFields = {};
        outer: for (var i=0,ilen=zoteroFields.length;i<ilen;i++) {
            var zField = Zotero.ItemFields.getName(zoteroFields[i]);
            for (var cField in Zotero.Schema.CSL_TEXT_MAPPINGS) { // Both title-short and shortTitle are okay for validation.
                var lst = Zotero.Schema.CSL_TEXT_MAPPINGS[cField];
                if (lst.indexOf(zField) > -1) {
                    validFields[cField] = true;
                    continue outer;
                }
            }
            for (var cField in Zotero.Schema.CSL_DATE_MAPPINGS) {
                var lst = Zotero.Schema.CSL_DATE_MAPPINGS[cField];
                if (lst.indexOf(zField) > -1) {
                    validFields[cField] = true;
                    continue outer;
                }
            }
        }
        return validFields;
    },
	
	/**
	 * Converts an item in CSL JSON format to a Zotero item
	 * @param {Zotero.Item} item
	 * @param {Object} cslItem
	 */
	"itemFromCSLJSON":function(item, cslItem, libraryID, portableJSON) {
		if (!Zotero.Utilities.Internal._mapsInitialized) Zotero.Utilities.Internal.initMaps();
		var isZoteroItem = !!item.setType,
			zoteroType;

		if (!cslItem.type) {
			throw new Error("No 'type' provided in CSL-JSON");
		}

		function _addCreator(creator, cslAuthor) {
			if(cslAuthor.family || cslAuthor.given) {
				creator.lastName = cslAuthor.family || '';
				creator.firstName = cslAuthor.given || '';
				return true;
			} else if(cslAuthor.literal) {
				creator.lastName = cslAuthor.literal;
				creator.fieldMode = 1;
				return true;
			} else {
				return false;
			}
		}

        var zoteroType = Utilities_Item.getZoteroTypeFromCslType(cslItem);

		var itemTypeID = Zotero.ItemTypes.getID(zoteroType);
		if(isZoteroItem) {
			item.setType(itemTypeID);
			if (libraryID) {
				item.setField('libraryID',libraryID);
			}
		} else {
			item.itemID = cslItem.id;
			item.itemType = zoteroType;
		}
		
		// map text fields
		for(let variable in Zotero.Schema.CSL_TEXT_MAPPINGS) { // Here, we accept both shortTitle and title-short
			if(variable in cslItem) {
				if ("string" !== typeof cslItem[variable]) {
					continue;
				}
				let textMappings = Zotero.Schema.CSL_TEXT_MAPPINGS[variable];
				for(var i=0; i<textMappings.length; i++) {
					var field = textMappings[i];
					var fieldID = Zotero.ItemFields.getID(field);
					
					if(Zotero.ItemFields.isBaseField(fieldID)) {
						var newFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(itemTypeID, fieldID);
						if(newFieldID) fieldID = newFieldID;
					}
					
					if(Zotero.ItemFields.isValidForType(fieldID, itemTypeID)) {
						// TODO: Convert restrictive Extra cheater syntax ('original-date: 2018')
						// to nicer format we allow ('Original Date: 2018'), unless we've added
						// those fields before we get to that
						if(isZoteroItem) {
							var mainLang = null;
							if (cslItem.multi) {
								mainLang = cslItem.multi.main[variable];
							}
							item.setField(fieldID, cslItem[variable], false, mainLang, true);
							if (cslItem.multi && cslItem.multi._keys[variable]) {
								for (var lang in cslItem.multi._keys[variable]) {
									item.setField(fieldID, cslItem.multi._keys[variable][lang], false, lang);
								}
							}
						} else {
							item[field] = cslItem[variable];
							if (cslItem.multi) {
								if (cslItem.multi.main && cslItem.multi.main[variable]) {
								    if (!item.multi.main[field]) {
									    item.multi.main[field] = {};
								    }
								    item.multi.main[field] = cslItem.multi.main[variable];
								}
								if (cslItem.multi._keys[variable]) {
									for (var lang in cslItem.multi._keys[variable]) {
										if (!item.multi._keys[field]) {
											item.multi._keys[field] = {};
										}
										item.multi._keys[field][lang] = cslItem.multi._keys[variable][lang]
									}
								}
							}
						}
						break;
					}
				}
			}
		}
		
		var jurisdictionFieldID = Zotero.ItemFields.getID("jurisdiction");
		if (Zotero.ItemFields.isValidForType(jurisdictionFieldID, itemTypeID) && ["report","newspaperArticle","journalArticle"].indexOf(zoteroType) === -1) {
			var val = cslItem["jurisdiction"];
			if (!val) {
				// XXX Replicated code pattern: move this to a function.
				var jurisdictionDefault = Zotero.Prefs.get("import.jurisdictionDefault");
				var jurisdictionFallback = Zotero.Prefs.get("import.jurisdictionFallback");
				if (jurisdictionDefault) {
					val = jurisdictionDefault;
				} else if (jurisdictionFallback) {
					val = jurisdictionFallback;
				} else {
					val = "us";
				}
			}
			if (isZoteroItem) {
				item.setField(jurisdictionFieldID, val);
			} else {
				item.jurisdiction = val;
			}
		}
		
		// separate name variables
        var doneField = {};
		for(let field in Zotero.Schema.CSL_NAME_MAPPINGS) {
            if (doneField[Zotero.Schema.CSL_NAME_MAPPINGS[field]]) continue;
			if(Zotero.Schema.CSL_NAME_MAPPINGS[field] in cslItem) {
				var creatorTypeID = Zotero.CreatorTypes.getID(field);
				if(!Zotero.CreatorTypes.isValidForItemType(creatorTypeID, itemTypeID)) {
					creatorTypeID = Zotero.CreatorTypes.getPrimaryIDForType(itemTypeID);
				}
				
				let nameMappings = cslItem[Zotero.Schema.CSL_NAME_MAPPINGS[field]];
				for(var i in nameMappings) {
					var cslAuthor = nameMappings[i];
					let creator = {multi:{_key:{}}};
					if (_addCreator(creator, cslAuthor)) {
						if (cslAuthor.multi) {
							if (cslAuthor.multi.main) {
								creator.multi.main = cslAuthor.multi.main;
							}
							for (let langTag in cslAuthor.multi._key) {
								var variant = creator.multi._key[langTag] = {};
								_addCreator(variant, cslAuthor.multi._key[langTag]);
							}
						}
					} else {
						continue;
					}
					creator.creatorTypeID = creatorTypeID;
					
					if(isZoteroItem) {
						// If portableJSON is indicated, fix or cut out invalid
						// creators here. If they are passed as-is, data recovery
						// form a document containing invalid creator entries will
						// fail, and we would be stuck -- and invalid entries
						// COULD sneak in, due to flaws in an earlier version of
						// Juris-M.
						if (portableJSON) {
							if (!creator.name && !creator.family && creator.given) {
								creator.family = creator.given;
								creator.given = "";
							}
							if (creator.name || creator.family) {
								item.setCreator(item.getCreators().length, creator);
							}
						} else {
							item.setCreator(item.getCreators().length, creator);
						}
					} else {
						creator.creatorType = Zotero.CreatorTypes.getName(creatorTypeID);
						if (Zotero.isFx && !Zotero.isBookmarklet) {
							creator = Components.utils.cloneInto(creator, item);
						}
						item.creators.push(creator);
					}
                    doneField[Zotero.Schema.CSL_NAME_MAPPINGS[field]] = true;
				}
			}
		}
		
		// get date variables
		for (let variable in Zotero.Schema.CSL_DATE_MAPPINGS) {
			if(variable in cslItem) {
				var fields = Zotero.Schema.CSL_DATE_MAPPINGS[variable],
					cslDate = cslItem[variable];
				// Recognize if extended field OR if fieldID is valid for type
				// and does not yet contain data.
				var fieldID = null;
				for (var i=0,ilen=fields.length;i<ilen;i++) {
					var field=fields[i];
					fieldID = Zotero.ItemFields.getID(field);
					if (Zotero.Utilities.Internal.ENCODE.FIELDS[zoteroType] && Zotero.Utilities.Internal.ENCODE.FIELDS[zoteroType][field]) {
						fieldID = Zotero.ItemFields.getID(field);
					}
					if(Zotero.ItemFields.isBaseField(fieldID)) {
						var newFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(itemTypeID, fieldID);
						if(newFieldID) fieldID = newFieldID;
						break;
					}
				}
				
				if(fieldID && Zotero.ItemFields.isValidForType(fieldID, itemTypeID)) {
					var date = "";
					if(cslDate.literal || cslDate.raw) {
						date = cslDate.literal || cslDate.raw;
						var country = Zotero.locale ? Zotero.locale.substr(3) : "US";
						if(country == "US" ||	// The United States
						   country == "FM" ||	// The Federated States of Micronesia
						   country == "PW" ||	// Palau
						   country == "PH") {	// The Philippines
							Zotero.DateParser.setOrderMonthDay();
						} else {
							Zotero.DateParser.setOrderDayMonth();
						}
						cslDate = Zotero.DateParser.parseDateToArray(date);
					}
					var newDate = Zotero.Utilities.deepCopy(cslDate);
					if(cslDate["date-parts"] && typeof cslDate["date-parts"] === "object"
					   && cslDate["date-parts"] !== null
					   && typeof cslDate["date-parts"][0] === "object"
					   && cslDate["date-parts"][0] !== null) {
						if(cslDate["date-parts"][0][0]) newDate.year = cslDate["date-parts"][0][0];
						if(cslDate["date-parts"][0][1]) newDate.month = cslDate["date-parts"][0][1];
						if(cslDate["date-parts"][0][2]) newDate.day = cslDate["date-parts"][0][2];
					}
					
					if(newDate.year) {
						if(variable === "accessed") {
							// Need to convert to SQL
							var date = Zotero.Utilities.lpad(newDate.year, "0", 4);
							if(newDate.month) {
								date += "-"+Zotero.Utilities.lpad(newDate.month, "0", 2);
								if(newDate.day) {
									date += "-"+Zotero.Utilities.lpad(newDate.day, "0", 2);
								}
							}
						} else {
							if(newDate.month) newDate.month--;
							date = Zotero.Date.formatDate(newDate);
							if(newDate.season) {
								date = newDate.season+" "+date;
							}
						}
					}

					if(isZoteroItem) {
						item.setField(fieldID, date);
					} else {
						item[field] = date;
					}
				}
			}
		}
		
		if (portableJSON) {
			// Decode MLZ fields
			// Conversion function works on JSON
			// Item is Zotero item at this point in processing
			// So ...
			// Convert item to JSON,
			// Run conversion
			// Convert back to Zotero item.
			var json = item.toJSON();
			json = Zotero.Jurism.SyncRecode.decode(json);
			item.fromJSON(json);
		}
	},
	
	/**
	 * Given API JSON for an item, return the best single first creator, regardless of creator order
	 *
	 * Note that this is just a single creator, not the firstCreator field return from the
	 * Zotero.Item::firstCreator property or Zotero.Items.getFirstCreatorFromData()
	 *
	 * @return {Object|false} - Creator in API JSON format, or false
	 */
	getFirstCreatorFromItemJSON: function (json) {
		var primaryCreatorType = Zotero.CreatorTypes.getName(
			Zotero.CreatorTypes.getPrimaryIDForType(
				Zotero.ItemTypes.getID(json.itemType)
			)
		);
		let firstCreator = json.creators.find(creator => {
			return creator.creatorType == primaryCreatorType || creator.creatorType == 'author';
		});
		if (!firstCreator) {
			firstCreator = json.creators.find(creator => creator.creatorType == 'editor');
		}
		if (!firstCreator) {
			return false;
		}
		return firstCreator;
	},

	/**
	* Taken from citeproc-js. Extracts particles (e.g. de, von, etc.) from family name and given name.
	* 
	* Copyright (c) 2009-2019 Frank Bennett
	*	This program is free software: you can redistribute it and/or
	*	modify it under EITHER
	*
	*	 * the terms of the Common Public Attribution License (CPAL) as
	*		published by the Open Source Initiative, either version 1 of
	*		the CPAL, or (at your option) any later version; OR
	*
	*	 * the terms of the GNU Affero General Public License (AGPL)
	*		as published by the Free Software Foundation, either version
	*		3 of the AGPL, or (at your option) any later version.
	*
	*	This program is distributed in the hope that it will be useful,
	*	but WITHOUT ANY WARRANTY; without even the implied warranty of
	*	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
	*	Affero General Public License for more details.
	*
	*	You should have received copies of the Common Public Attribution
	*	License and of the GNU Affero General Public License along with
	*	this program.  If not, see <https://opensource.org/licenses/> or
	*	<http://www.gnu.org/licenses/> respectively.
	*/
	parseParticles: function (nameObj) {
		function splitParticles(nameValue, firstNameFlag, caseOverride) {
			// Parse particles out from name fields.
			// * nameValue (string) is the field content to be parsed.
			// * firstNameFlag (boolean) parse trailing particles
			//	 (default is to parse leading particles)
			// * caseOverride (boolean) include all but one word in particle set
			//	 (default is to include only words with lowercase first char)
			//   [caseOverride is not used in this application]
			// Returns an array with:
			// * (boolean) flag indicating whether a particle was found
			// * (string) the name after removal of particles
			// * (array) the list of particles found
			var origNameValue = nameValue;
			nameValue = caseOverride ? nameValue.toLowerCase() : nameValue;
			var particleList = [];
			var rex;
			var hasParticle;
			if (firstNameFlag) {
				nameValue = nameValue.split("").reverse().join("");
				rex = Utilities_Item.PARTICLE_GIVEN_REGEXP;
			} else {
				rex = Utilities_Item.PARTICLE_FAMILY_REGEXP;
			}
			var m = nameValue.match(rex);
			while (m) {
				var m1 = firstNameFlag ? m[1].split("").reverse().join("") : m[1];
				var firstChar = m ? m1 : false;
				var firstChar = firstChar ? m1.replace(/^[-\'\u02bb\u2019\s]*(.).*$/, "$1") : false;
				hasParticle = firstChar ? firstChar.toUpperCase() !== firstChar : false;
				if (!hasParticle) {
					break;
				}
				if (firstNameFlag) {
					particleList.push(origNameValue.slice(m1.length * -1));
					origNameValue = origNameValue.slice(0,m1.length * -1);
				} else {
					particleList.push(origNameValue.slice(0,m1.length));
					origNameValue = origNameValue.slice(m1.length);
				}
				//particleList.push(m1);
				nameValue = m[2];
				m = nameValue.match(rex);
			}
			if (firstNameFlag) {
				nameValue = nameValue.split("").reverse().join("");
				particleList.reverse();
				for (var i=1,ilen=particleList.length;i<ilen;i++) {
					if (particleList[i].slice(0, 1) == " ") {
						particleList[i-1] += " ";
					}
				}
				for (var i=0,ilen=particleList.length;i<ilen;i++) {
					if (particleList[i].slice(0, 1) == " ") {
						particleList[i] = particleList[i].slice(1);
					}
				}
				nameValue = origNameValue.slice(0, nameValue.length);
			} else {
				nameValue = origNameValue.slice(nameValue.length * -1);
			}
			return [hasParticle, nameValue, particleList];
		}
		function trimLast(str) {
			var lastChar = str.slice(-1);
			str = str.trim();
			if (lastChar === " " && ["\'", "\u2019"].indexOf(str.slice(-1)) > -1) {
				str += " ";
			}
			return str;
		}
		function parseSuffix(nameObj) {
			if (!nameObj.suffix && nameObj.given) {
				var m = nameObj.given.match(/(\s*,!*\s*)/);
				if (m) {
					var idx = nameObj.given.indexOf(m[1]);
					var possible_suffix = nameObj.given.slice(idx + m[1].length);
					var possible_comma = nameObj.given.slice(idx, idx + m[1].length).replace(/\s*/g, "");
					if (possible_suffix.replace(/\./g, "") === 'et al' && !nameObj["dropping-particle"]) {
						// This hack covers the case where "et al." is explicitly used in the
						// authorship information of the work.
						nameObj["dropping-particle"] = possible_suffix;
						nameObj["comma-dropping-particle"] = ",";
					} else {
						if (possible_comma.length === 2) {
							nameObj["comma-suffix"] = true;
						}
						nameObj.suffix = possible_suffix;
					}
					nameObj.given = nameObj.given.slice(0, idx);
				}
			}
		}
		// Extract and set non-dropping particle(s) from family name field
		var res = splitParticles(nameObj.family);
		var lastNameValue = res[1];
		var lastParticleList = res[2];
		nameObj.family = lastNameValue;
		var nonDroppingParticle = trimLast(lastParticleList.join(""));
		if (nonDroppingParticle) {
			nameObj['non-dropping-particle'] = nonDroppingParticle;
		}
		// Split off suffix first of all
		parseSuffix(nameObj);
		// Extract and set dropping particle(s) from given name field
		var res = splitParticles(nameObj.given, true);
		var firstNameValue = res[1];
		var firstParticleList = res[2];
		nameObj.given = firstNameValue;
		var droppingParticle = firstParticleList.join("").trim();
		if (droppingParticle) {
			nameObj['dropping-particle'] = droppingParticle;
		}
	},

	/**
	 * Return first line (or first MAX_LENGTH characters) of note content
	 *
	 * @param {String} text
	 * @param {Object} [options]
	 * @param {Boolean} [options.stopAtLineBreak] - Stop at <br/> instead of converting to space
	 * @return {String}
	 */
	noteToTitle: function (text, options = {}) {
		var MAX_TITLE_LENGTH = 120;
		var origText = text;
		text = text.trim();
		// Add line breaks after block elements
		text = text.replace(/(<\/(h\d|p|div)+>)/g, '$1\n');
		if (options.stopAtLineBreak) {
			text = text.replace(/<br\s*\/?>/g, '\n');
		}
		else {
			text = text.replace(/<br\s*\/?>/g, ' ');
		}
		text = Zotero.Utilities.unescapeHTML(text);

		// If first line is just an opening HTML tag, remove it
		//
		// Example:
		//
		// <blockquote>
		// <p>Foo</p>
		// </blockquote>
		if (/^<[^>\n]+[^\/]>\n/.test(origText)) {
			text = text.trim();
		}

		var t = text.substring(0, MAX_TITLE_LENGTH);
		var ln = t.indexOf("\n");
		if (ln > -1 && ln < MAX_TITLE_LENGTH) {
			t = t.substring(0, ln);
		}
		return t;
	},

	/**
	 * Preprocess Zotero item extra field for passing to citeproc-js for extra CSL properties
	 * @param extra
	 * @returns {String|string|void|*}
	 */
	extraToCSL: function (extra) {
		return extra.replace(/^([A-Za-z \-]+)(:\s*.+)/gm, function (_, field, value) {
			var originalField = field;
			field = field.toLowerCase().replace(/ /g, '-');
			// Fields from https://aurimasv.github.io/z2csl/typeMap.xml
			switch (field) {
				// Standard fields
			case 'abstract':
			case 'accessed':
			case 'annote':
			case 'archive':
			case 'archive-place':
			case 'author':
			case 'authority':
			case 'call-number':
			case 'chapter-number':
			case 'citation-label':
			case 'citation-number':
			case 'collection-editor':
			case 'collection-number':
			case 'collection-title':
			case 'composer':
			case 'container':
			case 'container-author':
			case 'container-title':
			case 'container-title-short':
			case 'dimensions':
			case 'director':
			case 'edition':
			case 'editor':
			case 'editorial-director':
			case 'event':
			case 'event-date':
			case 'event-place':
			case 'first-reference-note-number':
			case 'genre':
			case 'illustrator':
			case 'interviewer':
			case 'issue':
			case 'issued':
			case 'jurisdiction':
			case 'keyword':
			case 'language':
			case 'locator':
			case 'medium':
			case 'note':
			case 'number':
			case 'number-of-pages':
			case 'number-of-volumes':
			case 'original-author':
			case 'original-date':
			case 'original-publisher':
			case 'original-publisher-place':
			case 'original-title':
			case 'page':
			case 'page-first':
			case 'publisher':
			case 'publisher-place':
			case 'recipient':
			case 'references':
			case 'reviewed-author':
			case 'reviewed-title':
			case 'scale':
			case 'section':
			case 'source':
			case 'status':
			case 'submitted':
			case 'title':
			case 'title-short':
			case 'translator':
			case 'type':
			case 'version':
			case 'volume':
			case 'year-suffix':
				break;

				// Uppercase fields
			case 'doi':
			case 'isbn':
			case 'issn':
			case 'pmcid':
			case 'pmid':
			case 'url':
				field = field.toUpperCase();
				break;

				// Weirdo
			case 'archive-location':
				field = 'archive_location';
				break;

			default:
				// See if this is a Zotero field written out (e.g., "Publication Title"), and if so
				// convert to its associated CSL field
				var zoteroField = originalField.replace(/ ([A-Z])/, '$1');
				// If second character is lowercase (so not an acronym), lowercase first letter too
				if (zoteroField[1] && zoteroField[1] == zoteroField[1].toLowerCase()) {
					zoteroField = zoteroField[0].toLowerCase() + zoteroField.substr(1);
				}
				if (Zotero.Schema.CSL_FIELD_MAPPINGS_REVERSE[zoteroField]) {
					field = Zotero.Schema.CSL_FIELD_MAPPINGS_REVERSE[zoteroField];
				}
				// Don't change other lines
				else {
					field = originalField;
				}
			}
			return field + value;
		});
	},

	/**
	 * Map a user-provided language name to an ISO 639-1 language code.
	 * Language names are matched against languages' English names and native
	 * names. Case and diacritics are ignored.
	 *
	 * @param {String} language
	 * @return {String}
	 */
	languageToISO6391: function (language) {
		if (!language) {
			return '';
		}

		if (!globalThis.Intl || !globalThis.Intl.DisplayNames) {
			Zotero.debug('Intl.DisplayNames not available: returning language as-is');
			return language;
		}

		let normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

		let languageMap = Utilities_Item._languageMap;
		if (!languageMap) {
			languageMap = Utilities_Item._languageMap = new Map();

			let allLocales = ["ab", "aa", "af", "ak", "sq", "am", "ar", "an", "hy", "as", "av", "ae", "ay", "az", "bm", "ba", "eu", "be", "bn", "bi", "bs", "br", "bg", "my", "ca", "ch", "ce", "ny", "zh", "cu", "cv", "kw", "co", "cr", "hr", "cs", "da", "dv", "nl", "dz", "en", "eo", "et", "ee", "fo", "fj", "fi", "fr", "fy", "ff", "gd", "gl", "lg", "ka", "de", "el", "kl", "gn", "gu", "ht", "ha", "he", "hz", "hi", "ho", "hu", "is", "io", "ig", "id", "ia", "ie", "iu", "ik", "ga", "it", "ja", "jv", "kn", "kr", "ks", "kk", "km", "ki", "rw", "ky", "kv", "kg", "ko", "kj", "ku", "lo", "la", "lv", "li", "ln", "lt", "lu", "lb", "mk", "mg", "ms", "ml", "mt", "gv", "mi", "mr", "mh", "mn", "na", "nv", "nd", "nr", "ng", "ne", "no", "nb", "nn", "ii", "oc", "oj", "or", "om", "os", "pi", "ps", "fa", "pl", "pt", "pa", "qu", "ro", "rm", "rn", "ru", "se", "sm", "sg", "sa", "sc", "sr", "sn", "sd", "si", "sk", "sl", "so", "st", "es", "su", "sw", "ss", "sv", "tl", "ty", "tg", "ta", "tt", "te", "th", "bo", "ti", "to", "ts", "tn", "tr", "tk", "tw", "ug", "uk", "ur", "uz", "ve", "vi", "vo", "wa", "cy", "wo", "xh", "yi", "yo", "za", "zu"];
			let englishLanguageNames = new Intl.DisplayNames('en', { type: 'language' });
			let userLanguageNames = new Intl.DisplayNames(Zotero.locale, { type: 'language' });
			for (let locale of Intl.DisplayNames.supportedLocalesOf(allLocales)) {
				let inEnglish = englishLanguageNames.of(locale);
				if (inEnglish) {
					languageMap.set(normalize(inEnglish), locale);
				}

				let inUser = userLanguageNames.of(locale);
				if (inUser) {
					languageMap.set(normalize(inUser), locale);
				}
			
				let selfLanguageNames = new Intl.DisplayNames(locale, { type: 'language' });
				let inSelf = selfLanguageNames.of(locale);
				if (inSelf) {
					languageMap.set(normalize(inSelf), locale);
				}
			}
		}

		return languageMap.get(normalize(language)) || language;
	},

	/**
	 * Converts an item from toArray() format to an array of items in
	 * the content=json format used by the server
	 *
	 * (for origin see: https://github.com/zotero/zotero/blob/56f9f043/chrome/content/zotero/xpcom/utilities.js#L1526-L1526)
	 *
	 */
	itemToAPIJSON: function(item) {
		var newItem = {
				key: Zotero.Utilities.generateObjectKey(),
				version: 0
			},
			newItems = [newItem];

		var typeID = Zotero.ItemTypes.getID(item.itemType);
		if(!typeID) {
			Zotero.debug(`itemToAPIJSON: Invalid itemType ${item.itemType}; using webpage`);
			item.itemType = "webpage";
			typeID = Zotero.ItemTypes.getID(item.itemType);
		}

		var accessDateFieldID = Zotero.ItemFields.getID('accessDate');

		var fieldID, itemFieldID;
		for(var field in item) {
			if(field === "complete" || field === "itemID" || field === "attachments"
				|| field === "seeAlso") continue;

			var val = item[field];

			if(field === "itemType") {
				newItem[field] = val;
			} else if(field === "creators") {
				// normalize creators
				var n = val.length;
				var newCreators = newItem.creators = [];
				for(var j=0; j<n; j++) {
					var creator = val[j];

					if(!creator.firstName && !creator.lastName) {
						Zotero.debug("itemToAPIJSON: Silently dropping empty creator");
						continue;
					}

					// Single-field mode
					if (!creator.firstName || (creator.fieldMode && creator.fieldMode == 1)) {
						var newCreator = {
							name: creator.lastName
						};
					}
					// Two-field mode
					else {
						var newCreator = {
							firstName: creator.firstName,
							lastName: creator.lastName
						};
					}

					// ensure creatorType is present and valid
					if(creator.creatorType) {
						if(Zotero.CreatorTypes.getID(creator.creatorType)) {
							newCreator.creatorType = creator.creatorType;
						} else {
							Zotero.debug(`itemToAPIJSON: Invalid creator type ${creator.creatorType}; `
								+ "falling back to author");
						}
					}
					if(!newCreator.creatorType) newCreator.creatorType = "author";

					newCreators.push(newCreator);
				}
			} else if(field === "tags") {
				// normalize tags
				var n = val.length;
				var newTags = newItem.tags = [];
				for(var j=0; j<n; j++) {
					var tag = val[j];
					if(typeof tag === "object") {
						if(tag.tag) {
							tag = tag.tag;
						} else if(tag.name) {
							tag = tag.name;
						} else {
							Zotero.debug("itemToAPIJSON: Discarded invalid tag");
							continue;
						}
					} else if(tag === "") {
						continue;
					}
					newTags.push({"tag":tag.toString(), "type":1});
				}
			} else if(field === "notes") {
				// normalize notes
				var n = val.length;
				for(var j=0; j<n; j++) {
					var note = val[j];
					if(typeof note === "object") {
						if(!note.note) {
							Zotero.debug("itemToAPIJSON: Discarded invalid note");
							continue;
						}
						note = note.note;
					}
					newItems.push({
						itemType: "note",
						parentItem: newItem.key,
						note: note.toString()
					});
				}
			} else if((fieldID = Zotero.ItemFields.getID(field))) {
				// if content is not a string, either stringify it or delete it
				if(typeof val !== "string") {
					if(val || val === 0) {
						val = val.toString();
					} else {
						continue;
					}
				}

				// map from base field if possible
				if((itemFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(typeID, fieldID))) {
					let fieldName = Zotero.ItemFields.getName(itemFieldID);
					// Only map if item field does not exist
					if(fieldName !== field && !newItem[fieldName]) newItem[fieldName] = val;
					continue;	// already know this is valid
				}

				// if field is valid for this type, set field
				if(Zotero.ItemFields.isValidForType(fieldID, typeID)) {
					// Convert access date placeholder to current time
					if (fieldID == accessDateFieldID && val == "CURRENT_TIMESTAMP") {
						val = Zotero.Date.dateToISO(new Date());
					}

					newItem[field] = val;
				} else {
					Zotero.debug(`itemToAPIJSON: Discarded field ${field}: `
						+ `field not valid for type ${item.itemType}`, 3);
				}
			} else {
				Zotero.debug(`itemToAPIJSON: Discarded unknown field ${field}`, 3);
			}
		}

		return newItems;
	},

	/**
	 * Converts a current Zotero Item to a format that export translators written for Zotero versions pre-4.0.26
	 * See https://github.com/zotero/translation-server/issues/73
	 * @param {Object} item
	 * @returns {Object}
	 */
	itemToLegacyExportFormat: function(item) {
		item.uniqueFields = {};

		// Map base fields
		for (let field in item) {
			try {
				var baseField = Zotero.ItemFields.getName(
					Zotero.ItemFields.getBaseIDFromTypeAndField(item.itemType, field)
				);
			} catch (e) {
				continue;
			}

			if (!baseField || baseField == field) {
				item.uniqueFields[field] = item[field];
			} else {
				item[baseField] = item[field];
				item.uniqueFields[baseField] = item[field];
			}
		}

		// Meaningless local item ID, but some older export translators depend on it
		item.itemID = Zotero.Utilities.randomString(6);
		item.key = Zotero.Utilities.randomString(6); // CSV translator exports this

		// "version" is expected to be a field for "computerProgram", which is now
		// called "versionNumber"
		delete item.version;
		if (item.versionNumber) {
			item.version = item.uniqueFields.version = item.versionNumber;
			delete item.versionNumber;
		}

		// Creators
		if (item.creators) {
			for (let i=0; i<item.creators.length; i++) {
				let creator = item.creators[i];

				if (creator.name) {
					creator.fieldMode = 1;
					creator.lastName = creator.name;
					delete creator.name;
				}

				// Old format used to supply creatorID (the database ID), but no
				// translator ever used it
			}
		}
		else {
			item.creators = [];
		}

		item.sourceItemKey = item.parentItem;

		// Tags
		if (item.tags) {
			for (let i = 0; i < item.tags.length; i++) {
				if (!item.tags[i].type) {
					item.tags[i].type = 0;
				}
				// No translator ever used "primary", "fields", or "linkedItems" objects
			}
		}
		else {
			item.tags = [];
		}

		// seeAlso was always present, but it was always an empty array.
		// Zotero RDF translator pretended to use it
		item.seeAlso = [];

		if (item.contentType) {
			item.mimeType = item.uniqueFields.mimeType = item.contentType;
		}

		if (item.note) {
			item.uniqueFields.note = item.note;
		}

		return item;
	},

	/**
	 * Compare two call numbers. Handles Dewey and LC specially,
	 * compares numbers as numbers, uses string comparison for everything else.
	 *
	 * @param {String} fieldA
	 * @param {String} fieldB
	 * @returns {Number} Negative if A < B, 0 if A == B, positive if A > B
	 */
	compareCallNumbers: function (fieldA, fieldB) {
		function compareStringArrays(a, b) {
			let i;
			for (i = 0; i < a.length && i < b.length; i++) {
				if (a[i] < b[i]) {
					return -1;
				}
				else if (a[i] > b[i]) {
					return 1;
				}
			}
			return (i < a.length) ? 1 : (i < b.length) ? -1 : 0;
		}

		let onlyNumbersRe = /^\d*$/;
		let deweyRe = /^(\d{3})(?:\.(\d+))?(?:\/([a-zA-Z]{3}))?$/;
		let lcWithClassificationRe = /^[a-zA-Z]{1,3}\d+($|(?=\s*[.\d]))/;

		if (onlyNumbersRe.test(fieldA) && onlyNumbersRe.test(fieldB)) {
			return parseInt(fieldA) - parseInt(fieldB);
		}

		let splitA = fieldA.toLowerCase().replace(/\s/g, '').match(deweyRe);
		let splitB = fieldB.toLowerCase().replace(/\s/g, '').match(deweyRe);
		if (splitA && splitB) {
			// Looks like Dewey Decimal, so we'll compare by parts
			splitA.shift();
			splitB.shift();
			return compareStringArrays(splitA, splitB);
		}
		
		let classificationA = fieldA.match(lcWithClassificationRe);
		let classificationB = fieldB.match(lcWithClassificationRe);
		if (classificationA && classificationB) {
			// Looks like a LC call number, so we'll first compare
			// by classification field using locale collation
			let classificationComp = Zotero.localeCompare(
				classificationA[0].replace(/[\s.]/g, ''),
				classificationB[0].replace(/[\s.]/g, '')
			);

			if (classificationComp == 0) {
				// If they match, we'll compare the rest using
				// basic string comparison
				fieldA = fieldA.substring(classificationA[0].length).replace(/[\s.]+/g, ' ');
				fieldB = fieldB.substring(classificationB[0].length).replace(/[\s.]+/g, ' ');
				return compareStringArrays(fieldA.split(' '), fieldB.split(' '));
			}
			else {
				return classificationComp;
			}
		}

		return (fieldA > fieldB) ? 1 : (fieldA < fieldB) ? -1 : 0;
	}
}

if (typeof module != 'undefined') {
	module.exports = Utilities_Item;
} else if (typeof Zotero != 'undefined' && typeof Zotero.Utilities != 'undefined') {
	Zotero.Utilities.Item = Utilities_Item;
} else {
	console.log('Could not find a way to expose utilities_item.js. Check your load order.')
}

})();
