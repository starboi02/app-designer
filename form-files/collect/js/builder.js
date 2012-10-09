'use strict';
define(['controller', 'opendatakit', 'database', 'jquery', 'promptTypes', 'formulaFunctions', 'underscore'],
function(controller,   opendatakit,   database,   $,        promptTypes,   formulaFunctions,   _) {
    var evalInEnvironment = (function() {
        //This closure will define a bunch of functions in our DSL for constraints/calculates/etc. 
        //It's still possible to really mess things up from here though because the
        //top-level environment is still accessable.
        //We can create some dummy variables to avoid that if need be.

        /*
        //I'm not sure if this is the best way to set up bindings in this closure/namespace.
        //The problem is it doesn't work with use strict
        for(var funcName in formulaFunctions){
            eval('var ' + funcName + ' = formulaFunctions.funcName;');
        }
        //The function consturctor might be worth looking into for this purpose.
        //However, I don't know if it works with webkit.
        //return (new Function).apply(_.keys(formulaFunctions).concat('eval(code)'));
        */
        //This is the way I'm setting up bindings for now, but it's suboptimal from a DRY perspective.
        var selected = formulaFunctions.selected;
        var V = formulaFunctions.V;
        var localize = formulaFunctions.localize;
        var equivalent = formulaFunctions.equivalent;
        
        return function(code){
            return eval(code);
        };
    })();
    
    return {
    //TODO: I think column_types and property parsers can be made private (i.e. defined in the closure above.).
    column_types: {
        condition: 'formula',
        constraint: 'formula',
        required: 'formula',
        validate: 'formula',
        calculation: 'formula',
        //TODO: Choice filter has some syntax issues to consider.
        //      It would be nice to have a "choice" variable we can refer to directly.
        //      One idea is to define variables in a context object that gets passed into the generated function.
        //      The generated function would then add the object's keys to the namespace.
        choiceFilter: 'formula',
        templatePath: 'requirejs_path',
        image: 'app_path_localized',
        audio: 'app_path_localized',
        video: 'app_path_localized'
    },
    propertyParsers: {
        formula: function(content) {
            if ( content === true || content === false ) {
                return function() { return content; }
            }
            var variablesRefrenced = [];
            var variableRegex = /\{\{.+?\}\}/g
                function replaceCallback(match) {
                    var variableName = match.slice(2, - 2);
                    variablesRefrenced.push(variableName);
                    return "this.database.getDataValue('" + variableName + "')";
                }
            content = content.replace(variableRegex, replaceCallback);
            var result = '(function(context){return (' + content + ');})';
            try {
                return evalInEnvironment(result);
            } catch (e) {
                alert("Could not evaluate formula: " + content + '\nSee console for details.');
                console.error(String(e));
                console.error(result);
                console.error(content);
                console.error(variablesRefrenced);
                return function(){};
            }
        },
        requirejs_path : function(content) {
            return opendatakit.getCurrentFormDirectory() + content;
        },
        app_path_localized : function(content) {
            var fd = opendatakit.getCurrentFormDirectory();
            if ( content == null ) {
                return content;
            } else if ( $.isPlainObject(content) ) {
                var newcontent = {};
                for ( var key in content ) {
                    var val = content[key];
                    if ( val.indexOf('/') == 0 || val.indexOf('http:') == 0 || val.indexOf('https:') == 0 ) {
                        newcontent[key] = val;
                    } else {
                        newcontent[key] = fd + val;
                    }
                }
                return newcontent;
            } else {
                if ( content.indexOf('/') == 0 || content.indexOf('http:') == 0 || content.indexOf('https:') == 0 ) {
                    return content;
                } else {
                    return fd + content;
                }
            }
        }
    },
    /**
     * 
     **/
    initializeProperties: function(prompt) {
        var that = this;
        $.each(prompt, function(key, property) {
            var propertyType, propertyContent;
            if (key in prompt) {
                if (typeof property === 'function') {
                    //Generally all properties will be plain JSON,
                    //but being able to pass in function directly can be useful for debugging.
                    return;
                }
                if ($.isArray(property)) {
                    return;
                }
                if ($.isPlainObject(property) && ('cell_type' in property)) {
                    propertyType = property.cell_type;
                    propertyContent = property['default'];
                }
                else {
                    if (key in that.column_types) {
                        propertyType = that.column_types[key];
                        propertyContent = property;
                    }
                    else {
                        //Leave the type as a string/int/bool
                        return;
                    }
                }
                if (propertyType in that.propertyParsers) {
                    var propertyParser = that.propertyParsers[propertyType];
                    console.log('Parsing:');
                    console.log(property);
                    prompt[key] = propertyParser(propertyContent);
                }
                else {
                    alert("Could not parse property of type " + propertyType + ". See console for details.");
                    console.error(propertyType);
                    console.error(prompt);
                }
            }
        });
        return prompt;
    },
    initializePrompts: function(prompts) {
        var that = this;
            function findObjectWithPair(objectArray, searchKey, searchValue) {
                for (var obby in objectArray) {
                    if (searchKey in obby) {
                        if (obby[searchKey] === searchValue) {
                            return obby;
                        }
                    }
                }
                return null;
            }
        var initializedPrompts = [];
        $.each(prompts, function(idx, item) {
                var PromptType;

                if (!('type' in item)) {
                    console.log('no type specified');
                    console.log(item);
                    return;
                }
                var widget = findObjectWithPair(that.form.widgets, 'type', item.type);
                if (widget) {
                    item = $.extend({}, widget, item);
                    item.type = widget.parentType;
                }
                if (item.type in promptTypes) {
                    PromptType = promptTypes[item.type];
                }
                else {
                    console.log('unknown type');
                    console.log(item);
                    PromptType = promptTypes['text'];
                }
                var PromptClass = PromptType.extend($.extend({
                    form: that.form,
                    promptIdx: idx
                }, that.initializeProperties(item)));
            initializedPrompts.push(new PromptClass());
            });
        return initializedPrompts;
    },
    buildSurvey:function(surveyJson, continuation){
            // if we have no survey object, we are bootstrapping
            // just run the continuation (which will register a
            // hash change processor).
            if (surveyJson == null) {
                continuation();
                return;
            }
            
            var that = this;

            var widgets = {};

            //Load scripts specified in settings somewhere after this point
            if ('widgets' in surveyJson) {
                //Transform and initialize widgets?
                $.extend(widgets, surveyJson.widgets);
            }
            //Load scripts specified in settings somewhere after this point
            if ('column_types' in surveyJson) {
                $.extend(this.column_types, surveyJson.column_types);
            }
            that.form = {
                choices: surveyJson.choices,
                settings: surveyJson.settings,
                widgets: widgets
            };

            var navs = [];
            var calculates = [];
            for ( var i = 0 ; i < surveyJson.survey.length ; ++i ) {
                var surveyItem = surveyJson.survey[i];
                if ( surveyItem.type == "calculate" ) {
                    calculates.push(surveyItem);
                } else {
                    navs.push(surveyItem);
                }
            }
            var prompts = ([{
                "type": "goto_if",
                "condition": function() {
                    return (database.getMetaDataValue('instanceId') != null);
                },
                "param": "_begin"
            }, {
                type: "instances",
                name: "_instances",
                label: "Saved Instances"
            }, {
                "type": "label",
                "param": "_output"
            }, {
                type: "json",
                name: "_json",
                label: "JSON formatted survey answers"
            }, {
                "type": "label",
                "param": "_begin"
            }, {
                type: "opening",
                name: "_opening",
                label: "opening page"
            }]).concat(navs).concat([{
                type: "finalize",
                name: "_finalize",
                label: "Save Form"
            }, {
                type: "hierarchy",
                name: "_hierarchy",
                label: "Hierarchy View"
            }]);

            console.log('initializing');
            that.form.prompts = this.initializePrompts(prompts);
            calculates = this.initializePrompts(calculates);
            controller.prompts = that.form.prompts;
            //controller.calcs = that.form.calcs;
            console.log('starting');
            continuation();
        }
    };
});
