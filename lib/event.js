const moment = require('moment-timezone')

const {buildInvalidProposalError, buildUnfinalizedEventError, buildFinalizedEventError} = require('./errors')

class Proposal {
  constructor (ts) {
    this.ts = ts
    this.accepted = new Set()
    this.leading = false
  }

  date () { return this.ts }

  yesCount () { return this.accepted.size }

  isLeading () { return this.leading }

  yes (uid) { this.accepted.add(uid) }

  no (uid) { this.accepted.delete(uid) }

  isAttending (uid) { return this.accepted.has(uid) }

  getAttendees () { return Array.from(this.accepted) }

  markLeader () { this.leading = true }

  clearLeader () { this.leading = false }

  serialize () {
    return {
      ts: this.ts.valueOf(),
      zone: this.ts.tz(),
      accepted: Array.from(this.accepted)
    }
  }

  static deserialize (payload) {
    const p = new Proposal(moment.tz(payload.ts, payload.zone))
    p.accepted = new Set(payload.accepted)
    return p
  }
}

class Event {
  constructor (id, name) {
    this.id = id
    this.name = name
    this.proposals = []
    this.invitees = new Set()
    this.responses = new Set()
    this.finalized = null
    this.earliest = null
    this.latest = null
  }

  getID () { return this.id }

  setName (name) { this.name = name }

  getName () { return this.name }

  proposeDate (ts) {
    if (this.isFinalized()) {
      throw buildFinalizedEventError({eventID: this.id, eventName: this.name})
    }

    const p = new Proposal(ts)
    this.proposals.push(p)

    if (!this.earliest || p.date().isBefore(this.earliest.date())) {
      this.earliest = p
    }
    if (!this.latest || p.date().isAfter(this.latest.date())) {
      this.latest = p
    }

    return this.proposals.length - 1
  }

  unpropose (index) {
    if (this.earliest === this.proposals[index]) {
      this.earliest = this.proposals.reduce((min, p, ind) => {
        if (ind === index) return min
        if (min === null) return p
        if (p.date().isBefore(min.date())) return p
        return min
      }, null)
    }

    if (this.latest === this.proposals[index]) {
      this.latest = this.proposals.reduce((max, p, ind) => {
        if (ind === index) return max
        if (max === null) return p
        if (p.date().isAfter(max.date())) return p
        return max
      }, null)
    }

    delete this.proposals[index]
    if (this.finalized === index) this.finalized = null
  }

  proposalKeys () {
    return Object.keys(this.proposals).map(k => parseInt(k, 10))
  }

  proposal (index) {
    const p = this.proposals[index]
    if (p === undefined) {
      throw buildInvalidProposalError({
        eventID: this.id,
        eventName: this.name,
        proposal: index
      })
    }
    return p
  }

  invite (uid) {
    this.invitees.add(uid)
  }

  uninvite (uid) {
    this.invitees.delete(uid)
  }

  getInvitees () {
    return Array.from(this.invitees)
  }

  acceptProposal (uid, proposalIndex) {
    this.invitees.add(uid)
    this.responses.add(uid)
    this.proposal(proposalIndex).yes(uid)
    this.remarkLeader()
  }

  rejectProposal (uid, proposalIndex) {
    this.responses.add(uid)
    this.proposal(proposalIndex).no(uid)
    this.remarkLeader()
  }

  responded (uid) {
    this.responses.add(uid)
  }

  finalize (index) {
    if (this.proposals[index] === undefined) {
      throw buildInvalidProposalError({
        eventID: this.id,
        eventName: this.name,
        proposal: index
      })
    }

    if (this.isFinalized()) {
      throw buildFinalizedEventError({eventID: this.id, eventName: this.name})
    }

    this.finalized = index
  }

  finalProposal () {
    if (this.finalized === null) {
      throw buildUnfinalizedEventError({
        eventID: this.id,
        eventName: this.name
      })
    }
    return this.proposal(this.finalized)
  }

  unfinalize () {
    this.finalized = null
  }

  isFinalized () {
    return this.finalized !== null
  }

  remarkLeader () {
    let leadingCount = 2
    for (const proposal of this.proposals) {
      if (proposal.yesCount() > leadingCount) {
        leadingCount = proposal.yesCount()
      }
    }
    for (const proposal of this.proposals) {
      if (proposal.yesCount() === leadingCount) {
        proposal.markLeader()
      } else {
        proposal.clearLeader()
      }
    }
  }

  earliestComparisonDate () {
    if (this.isFinalized()) {
      return this.finalProposal().date()
    } else if (this.earliest) {
      return this.earliest.date()
    } else {
      return null
    }
  }

  latestComparisonDate () {
    if (this.isFinalized()) {
      return this.finalProposal().date()
    } else if (this.latest) {
      return this.latest.date()
    } else {
      return null
    }
  }

  compareTo (other) {
    const a = this.earliestComparisonDate()
    const b = other.earliestComparisonDate()

    if (a === b) return 0
    if (a === null) return -1
    if (b === null) return 1
    if (a.isSame(b)) return 0

    return a.isBefore(b) ? -1 : 1
  }

  matches (filter) {
    let m = true
    const e = this.earliestComparisonDate()
    const l = this.latestComparisonDate()

    if (filter.finalized) {
      if (!this.isFinalized()) m = false
    }

    if (filter.unfinalized) {
      if (this.isFinalized()) m = false
    }

    if (filter.before && e !== null) {
      if (e.isAfter(filter.before)) m = false
    }

    if (filter.after && l !== null) {
      if (l.isBefore(filter.after)) m = false
    }

    if (filter.invited) {
      if (!this.invitees.has(filter.invited)) m = false
    }

    return m
  }

  asAttachment (ref) {
    const a = {
      fallback: `${this.id}: ${this.name}`,
      title: `\`${this.id}\` :calendar: ${this.name}`,
      fields: [],
      mrkdwn_in: ['fields']
    }

    if (this.finalized === null) {
      if (this.proposals.length === 0) {
        a.fields.push({
          title: 'Proposed Dates',
          value: '_none yet_'
        })
      } else {
        const value = this.proposals.map((proposal, index) => {
          let str = `[${index}] ${proposal.date().format('D MMMM YYYY')}`
          str += ` _${proposal.date().from(ref)}_`
          if (proposal.isLeading()) {
            str += ' :medal:'
          }
          if (proposal.yesCount() > 0) {
            str += ` x${proposal.yesCount()}`
          }
          return str
        }).filter(Boolean).join('\n')
        a.fields.push({title: 'Proposed Dates', value})
      }

      if (this.invitees.size > 0) {
        const value = '_Responses_\n' + Array.from(this.invitees, uid => {
          let str = ''
          if (this.responses.has(uid)) {
            str += ':white_square_button:'
          } else {
            str += ':white_square:'
          }
          str += ` ${uid}`
          return str
        }).join(' | ')

        a.fields.push({title: 'Who', value})
      }
    } else {
      const proposal = this.finalProposal()
      a.fields.push({
        title: 'When',
        value: `${proposal.date().format('D MMMM YYYY')} _${proposal.date().from(ref)}_`
      })

      if (this.invitees.size > 0) {
        const value = '_Attendees_\n' + Array.from(this.invitees, uid => {
          let str = ''
          if (!this.responses.has(uid)) {
            str += ':grey_question:'
          } else if (proposal.isAttending(uid)) {
            str += ':white_check_mark:'
          } else {
            str += ':red_circle:'
          }

          str += ` ${uid}`
          return str
        }).join(' | ')

        a.fields.push({title: 'Who', value})
      }
    }

    return a
  }

  serialize () {
    return {
      id: this.id,
      name: this.name,
      invitees: Array.from(this.invitees),
      responses: Array.from(this.responses),
      finalized: this.finalized,
      proposals: this.proposals.map(p => p.serialize())
    }
  }

  static deserialize (payload) {
    const e = new Event(payload.id, payload.name)
    e.invitees = new Set(payload.invitees)
    e.responses = new Set(payload.responses)
    e.proposals = payload.proposals.map(Proposal.deserialize)
    e.finalized = payload.finalized
    return e
  }
}

module.exports = {Event}
