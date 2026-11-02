// Shared by the site owner's ability routes (api/siteOwner/abilities.js) and the admin's (api/
// admin/index.js): the Ability shape, the owned-ability lookup and the ability audit event.
//
// An ability's audit event carries its whole state after the change in metadata, so the log alone
// can rebuild every ability's history (a slowly changing dimension, Planned Later → Audit
// analytics). The request note is the site owner's own text and never goes into it.
const prisma = require('../prisma');
const { ownedWebsiteWhere } = require('./ownership');
const { recordAuditEvent } = require('./audit');

const ABILITY_SELECT = {
  id: true,
  websiteId: true,
  kind: true,
  status: true,
  turnedOn: true,
  requestNote: true,
  requestedAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
};

// An ability the site owner has: its website is theirs and active, and it isn't removed.
function findOwnedAbility(accountId, abilityId) {
  return prisma.websiteAbility.findFirst({
    where: { id: abilityId, removedAt: null, website: ownedWebsiteWhere(accountId) },
    select: ABILITY_SELECT,
  });
}

// Prisma row (selected with ABILITY_SELECT) → the contract's Ability shape.
function toAbility(ability) {
  return {
    id: ability.id,
    kind: ability.kind,
    status: ability.status,
    turnedOn: ability.turnedOn,
    requestNote: ability.requestNote,
    requestedAt: ability.requestedAt,
    createdAt: ability.createdAt,
    updatedAt: ability.updatedAt,
  };
}

// `ability` is the row after the change, selected with ABILITY_SELECT.
function recordAbilityEvent(tx, req, action, ability) {
  return recordAuditEvent(tx, req, {
    action,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'ability',
    targetId: ability.id,
    metadata: {
      websiteId: ability.websiteId,
      kind: ability.kind,
      status: ability.status,
      turnedOn: ability.turnedOn,
      removed: ability.removedAt !== null,
    },
  });
}

module.exports = {
  ABILITY_SELECT,
  findOwnedAbility,
  toAbility,
  recordAbilityEvent,
};
