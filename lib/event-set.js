const ical = require('ical-toolkit')

class EventSet {
  constructor (robot, events) {
    this.robot = robot
    this.events = events
  }

  size () { return this.events.length }

  at (ind) { return this.events[ind] }

  asLines () {
    return this.events.map(e => e.asLine())
  }

  renderICal ({calendarName, userTz}) {
    const builder = ical.createIcsFileBuilder()
    builder.spacers = false
    builder.throwError = true
    builder.ignoreTZIDMismatch = false

    builder.calname = calendarName
    builder.timezone = userTz
    builder.tzid = userTz

    for (const evt of this.events) {
      evt.renderICalOn(this.robot, builder)
    }

    return builder.toString()
  }
}

module.exports = {EventSet}
