'use strict'

/* global cy, Cypress */
const itsName = require('its-name')
const { initStore } = require('snap-shot-store')
const la = require('lazy-ass')
const is = require('check-more-types')
const compare = require('snap-shot-compare')
const path = require('path')

const {
  serializeDomElement,
  serializeReactToHTML,
  identity,
  countSnapshots
} = require('./utils')

/* eslint-disable no-console */

function compareValues ({ expected, value }) {
  const noColor = true
  const json = true
  return compare({ expected, value, noColor, json })
}

function registerCypressSnapshot (options) {
  la(is.fn(global.before), 'missing global before function')
  la(is.fn(global.after), 'missing global after function')
  la(is.object(global.Cypress), 'missing Cypress object')
  options = options || {}
  console.log('registering @cypress/snapshot')

  let storeSnapshot

  // for each full test name, keeps number of snapshots
  // allows using multiple snapshots inside single test
  // without confusing them
  // eslint-disable-next-line immutable/no-let
  let counters = {}

  function getSnapshotIndex (key) {
    if (key in counters) {
      // eslint-disable-next-line immutable/no-mutation
      counters[key] += 1
    } else {
      // eslint-disable-next-line immutable/no-mutation
      counters[key] = 1
    }
    return counters[key]
  }

  const SNAPSHOT_FILENAME = path.join(options.snapshotPath, 'snapshots.js')

  function evaluateLoadedSnapShots (js) {
    la(is.string(js), 'expected JavaScript snapshot source', js)
    console.log('read snapshots.js file')
    const store = eval(js) || {}
    console.log('have %d snapshot(s)', countSnapshots(store))
    storeSnapshot = initStore(store)
  }

  function readJsSnapshot (snapshotFilename) {
    cy
    .readFile(snapshotFilename, 'utf-8', { log: false })
    .then(evaluateLoadedSnapShots)
    // no way to catch an error yet
  }

  function readJsonSnapshot (indexFilename) {
    let store = {}
    cy.readFile(indexFilename, 'utf-8', { log: false }).then(function (index) {
      if (!index.snapshots) {
        return
      }
      index.snapshots.forEach(function (snapFile) {
        cy.readFile(snapFile, 'utf-8', { log: false }).then(function (snapshots) {
          Object.assign(store, snapshots)
        })
      })
    })
    storeSnapshot = initStore(store)
  }

  global.before(function loadSnapshots () {
    if (options.format === 'json') {
      readJsonSnapshot(path.join(options.snapshotPath, 'index.json'))
    } else {
      readJsSnapshot(SNAPSHOT_FILENAME)
    }
  })

  function getTestName (test) {
    const names = itsName(test)
    // la(is.strings(names), 'could not get name from current test', test)
    return names
  }

  function getSnapshotName (test, humanName) {
    const names = getTestName(test)
    const key = names.join(' - ')
    const index = humanName || getSnapshotIndex(key)
    names.push(String(index))
    return names
  }

  function setSnapshot (name, value, $el) {
    // snapshots were not initialized
    if (!storeSnapshot) {
      return
    }

    // show just the last part of the name list (the index)
    const message = Cypress._.last(name)
    console.log('current snapshot name', name)

    const devToolsLog = {
      value
    }
    if (Cypress.dom.isJquery($el)) {
      // only add DOM elements, otherwise "expected" value is enough
      devToolsLog.$el = $el
    }

    const options = {
      name: 'snapshot',
      message,
      consoleProps: () => devToolsLog
    }

    if ($el) {
      options.$el = $el
    }

    const cyRaiser = ({ value, expected }) => {
      const result = compareValues({ expected, value })
      result.orElse((json) => {
        // by deleting property and adding it at the last position
        // we reorder how the object is displayed
        // We want convenient:
        //   - message
        //   - expected
        //   - value
        devToolsLog.message = json.message
        devToolsLog.expected = expected
        delete devToolsLog.value
        devToolsLog.value = value
        throw new Error(`Snapshot difference\n${json.message}`)
      })
    }

    Cypress.log(options)
    storeSnapshot({
      value,
      name,
      raiser: cyRaiser
    })
  }

  const pickSerializer = (asJson, value) => {
    if (Cypress.dom.isJquery(value)) {
      return asJson ? serializeDomElement : serializeReactToHTML
    }
    return identity
  }

  function snapshot (value, { name, json } = {}) {
    console.log('human name', name)
    const snapshotName = getSnapshotName(this.test, name)
    const serializer = pickSerializer(json, value)
    const serialized = serializer(value)
    setSnapshot(snapshotName, serialized, value)

    // always just pass value
    return value
  }

  Cypress.Commands.add('snapshot', { prevSubject: true }, snapshot)

  global.after(function saveSnapshots () {
    if (!storeSnapshot) {
      return
    }
    const snapshots = storeSnapshot()
    console.log('%d snapshot(s) on finish', countSnapshots(snapshots))
    if (options.format === 'json') {
      const snapFiles = []
      Object.keys(snapshots).forEach((snap) => {
        const content = Object.assign({}, { [snap]: snapshots[snap] })
        const baseName = snap.replace(/\W/g, '').concat('.json')
        const snapPath = path.join(options.snapshotPath, baseName)
        cy.writeFile(snapPath, content)
        snapFiles.push(snapPath)
      })
      const index = { __version: Cypress.version, snapshots: snapFiles }
      cy.writeFile(path.join(options.snapshotPath, 'index.json'), index)
    } else {
      snapshots.__version = Cypress.version
      const s = JSON.stringify(snapshots, null, 2)
      const str = `module.exports = ${s}\n`
      cy.writeFile(SNAPSHOT_FILENAME, str, 'utf-8', { log: false })
    }
  })
  return snapshot
}

module.exports = {
  register: registerCypressSnapshot
}
