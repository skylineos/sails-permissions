'use strict';

const path = require('path');
const _ = require('lodash');
const Marlinspike = require('marlinspike');

var permissionPolicies = [
  'passport',
  'sessionAuth',
  'ModelPolicy',
  'OwnerPolicy',
  'PermissionPolicy',
  'RolePolicy'
];

class Permissions extends Marlinspike {
  constructor (sails) {
    super(sails, module)
  }

  configure () {
    if (!_.isObject(sails.config.permissions)) sails.config.permissions = { }

    /**
     * workaround for #219:
     * If your _actually_ want to populate blueprint models, you should set `populateForce` filed in config
     */
    var populateForce = this.sails.config.blueprints.populateForce;
    if (populateForce) {
      this.sails.config.blueprints.populate = !!populateForce;
    } else {
      /**
       * Local cache of Model name -> id mappings to avoid excessive database lookups.
       */
      this.sails.config.blueprints.populate = false
    }
  }

  initialize (next) {
    let config = this.sails.config.permissions

    this.installModelOwnership()
    this.sails.after(config.afterEvent, () => {
      if (!this.validateDependencies()) {
        this.sails.log.error('Cannot find sails-auth hook. Did you "npm install sails-auth --save"?')
        this.sails.log.error('Please see README for installation instructions: https://github.com/tjwebb/sails-permissions')
        return this.sails.lower()
      }

      if (!this.validatePolicyConfig()) {
        this.sails.log.warn('One or more required policies are missing.')
        this.sails.log.warn('Please see README for installation instructions: https://github.com/tjwebb/sails-permissions')
      }

    })

    this.sails.after('hook:orm:loaded', () => {
      sails.models.model.count()
        .then(count => {
          if (count === _.keys(this.sails.models).length) return next()

          return this.initializeFixtures()
            .then(() => {
              next()
            })
        })
        .catch(error => {
          this.sails.log.error(error)
          next(error)
        })
    })
  }

  validatePolicyConfig () {
    var policies = this.sails.config.policies
    return _.all([
      _.isArray(policies['*']),
      _.intersection(permissionPolicies, policies['*']).length === permissionPolicies.length,
      policies.AuthController && _.contains(policies.AuthController['*'], 'passport')
    ])
  }

  installModelOwnership () {
    var models = this.sails.models
    if (this.sails.config.models.autoCreatedBy === false) return

    _.each(models, model => {
      if (model.autoCreatedBy === false) return

      _.defaults(model.attributes, {
        createdBy: {
          model: 'User',
          index: true
        },
        owner: {
          model: 'User',
          index: true
        }
      })
    })
  }

  /**
  * Install the application. Sets up default Roles, Users, Models, and
  * Permissions, and creates an admin user.
  */
  initializeFixtures () {
    let fixturesPath = path.resolve(__dirname, '../../../config/fixtures/')
    return require(path.resolve(fixturesPath, 'model')).createModels()
      .then(models => {
        this.models = models
        this.sails.hooks.permissions._modelCache = _.indexBy(models, 'identity')

        return require(path.resolve(fixturesPath, 'role')).create()
      })
      .then(roles => {
        this.roles = roles
        var userModel = _.find(this.models, { name: 'User' })
        return require(path.resolve(fixturesPath, 'user')).create(this.roles, userModel)
      })
      .then(() => {
        return sails.models.user.findOne({ email: this.sails.config.permissions.adminEmail })
      })
      .then(user => {
        this.sails.log('sails-permissions: created admin user:', user)
        user.createdBy = user.id
        user.owner = user.id
        return user.save()
      })
      .then(admin => {
        return require(path.resolve(fixturesPath, 'permission')).create(this.roles, this.models, admin, this.sails.config.permissions);
      })
      .catch(error => {
        this.sails.log.error(error)
      })
  }

  validateDependencies () {
    return !!this.sails.hooks.auth;
  }
}

module.exports = Marlinspike.createSailsHook(Permissions);
