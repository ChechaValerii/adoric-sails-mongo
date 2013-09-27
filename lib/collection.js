
/**
 * Module dependencies
 */

var _ = require('lodash'),
    utils = require('./utils'),
    Connection = require('./connection'),
    Document = require('./document'),
    Query = require('./query');

/**
 * Manage A Collection
 *
 * @param {Object} definition
 */

var Collection = module.exports = function Collection(definition) {

  // Set an identity for this collection
  this.identity = '';

  // Hold Configuration for this collection
  this.config = {};

  // Hold Schema Information
  this.schema = null;

  // Hold Indexes
  this.indexes = [];

  // Parse the definition into collection attributes
  this.parseDefinition(definition);

  // Build an indexes dictionary
  this.buildIndexes();

  return this;
};


/////////////////////////////////////////////////////////////////////////////////
// PRIVATE METHODS
/////////////////////////////////////////////////////////////////////////////////


/**
 * Parse Collection Definition
 *
 * @param {Object} definition
 * @api private
 */

Collection.prototype.parseDefinition = function parseDefinition(definition) {
  var self = this,
      collectionDef = _.cloneDeep(definition);

  // Load the url connection parameters if set
  this.config = utils.parseUrl(collectionDef.config);

  // Hold the Schema
  this.schema = collectionDef.definition;

  // Remove any Auto-Increment Keys, Mongo currently doesn't handle this well without
  // creating additional collection for keeping track of the increment values
  Object.keys(this.schema).forEach(function(key) {
    if(self.schema[key].autoIncrement) delete self.schema[key].autoIncrement;
  });

  // Set the identity
  this.identity = collectionDef.identity.toLowerCase();
};

/**
 * Build Internal Indexes Dictionary based on the current schema.
 *
 * @api private
 */

Collection.prototype.buildIndexes = function buildIndexes() {
  var self = this;

  Object.keys(this.schema).forEach(function(key) {
    var index = {},
        options = {};

    // Handle Unique Indexes
    if(self.schema[key].unique) {

      // Set the index sort direction, doesn't matter for single key indexes
      index[key] = 1;

      // Set the index options
      options.sparse = true;
      options.unique = true;

      // Store the index in the collection
      self.indexes.push({ index: index, options: options });
      return;
    }

    // Handle non-unique indexes
    if(self.schema[key].index) {

      // Set the index sort direction, doesn't matter for single key indexes
      index[key] = 1;

      // Set the index options
      options.sparse = true;

      // Store the index in the collection
      self.indexes.push({ index: index, options: options });
      return;
    }
  });
};


/////////////////////////////////////////////////////////////////////////////////
// PUBLIC METHODS
/////////////////////////////////////////////////////////////////////////////////


/**
 * Find Documents
 *
 * @param {Object} criteria
 * @param {Function} callback
 * @api public
 */

Collection.prototype.find = function find(criteria, cb) {
  var self = this,
      connection = new Connection(this.config),
      query;

  // Catch errors build query and return to the callback
  try {
    query = new Query(criteria);
  } catch(err) {
    return cb(err);
  }

  connection.open(function() {
    var collection = connection.database.collection(self.identity);

    // Check for aggregate query
    if(query.aggregate) {
      var aggregate = [
        { '$match': query.criteria.where || {} },
        { '$group': query.aggregateGroup }
      ];

      return collection.aggregate(aggregate, function(err, results) {
        connection.database.close(function() {

          // Results have grouped by values under _id, so we extract them
          var mapped = results.map(function(result) {
            for(var key in result._id) {
              result[key] = result._id[key];
            }
            delete result._id;
            return result;
          });

          cb(err, mapped);
        });
      });
    }

    var where = query.criteria.where || {};
    var queryOptions = _.omit(query.criteria, 'where');

    // Run Normal Query on collection
    collection.find(where, queryOptions).toArray(function(err, docs) {
      connection.database.close(function() {
        if(err) return cb(err);
        cb(null, utils.rewriteIds(docs));
      });
    });
  });
};

/**
 * Insert A New Document
 *
 * @param {Object|Array} values
 * @param {Function} callback
 * @api public
 */

Collection.prototype.insert = function insert(values, cb) {
  var self = this,
      connection = new Connection(this.config);

  // Normalize values to an array
  if(!_.isArray(values)) values = [values];

  // Build a Document and add the values to a new array
  var docs = values.map(function(value) {
    return new Document(value, self.schema).values;
  });

  connection.open(function() {
    connection.database.collection(self.identity).insert(docs, function(err, results) {
      connection.database.close(function() {
        if(err) return cb(err);
        cb(null, utils.rewriteIds(results));
      });
    });
  });
};

/**
 * Update Documents
 *
 * @param {Object} criteria
 * @param {Object} values
 * @param {Function} callback
 */

Collection.prototype.update = function update(criteria, values, cb) {
  var self = this,
      connection = new Connection(this.config),
      query;

  // Catch errors build query and return to the callback
  try {
    query = new Query(criteria);
  } catch(err) {
    return cb(err);
  }

  values = new Document(values, this.schema).values;

  // Mongo doesn't allow ID's to be updated
  if(values.id) delete values.id;
  if(values._id) delete values._id;

  connection.open(function() {
    var collection = connection.database.collection(self.identity);

    // Lookup records being updated and grab their ID's
    // Useful for later looking up the record after an insert
    // Required because options may not contain an ID
    collection.find(query.criteria.where).toArray(function(err, records) {
      if(err || !records) {
        return connection.database.close(function() {
          if(err) return cb(err);
          return cb(new Error('Could not find any records to update'));
        });
      }

      // Build an array of records
      var updatedRecords = [];

      records.forEach(function(record) {
        updatedRecords.push(record._id);
      });

      // Update the records
      collection.update(query.criteria.where, { '$set': values }, { multi: true }, function(err, result) {
        if(err) {
          return connection.database.close(function() {
            cb(err);
          });
        }

        // Look up newly inserted records to return the results of the update
        collection.find({ _id: { '$in': updatedRecords }}).toArray(function(err, records) {
          connection.database.close(function() {
            if(err) return cb(err);
            cb(null, utils.rewriteIds(records));
          });
        });
      });
    });
  });
};

/**
 * Destroy Documents
 *
 * @param {Object} criteria
 * @param {Function} callback
 */

Collection.prototype.destroy = function destroy(criteria, cb) {
  var self = this,
      connection = new Connection(this.config),
      query;

  // Catch errors build query and return to the callback
  try {
    query = new Query(criteria);
  } catch(err) {
    return cb(err);
  }

  connection.open(function() {
    connection.database.collection(self.identity).remove(query.criteria.where, function(err, results) {
      connection.database.close(function() {
        if(err) return cb(err);

        // Force to array to meet Waterline API
        var resultsArray = [];

        // If result is not an array return an array
        if(!Array.isArray(results)) {
          resultsArray.push({ id: results });
          return cb(null, resultsArray);
        }

        // Create a valid array of IDs
        results.forEach(function(result) {
          resultsArray.push({ id: result });
        });

        cb(null, utils.rewriteIds(resultArray));
      });
    });
  });
};