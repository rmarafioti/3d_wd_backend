// Message threads between a site owner and the admin: their shapes, unread state per side, and
// starting one or adding a message, shared by both sides' routes.
const prisma = require('../prisma');
const { ServerError } = require('../errors');
const { AUDIT_ACTIONS, recordAuditEvent } = require('./audit');

const THREAD_NOT_FOUND = 'Thread not found.';
const MAX_THREAD_MESSAGES = 100;

// Each side's read time column: 'owner' is the site owner who started the thread.
const READ_AT = { owner: 'ownerReadAt', admin: 'adminReadAt' };

const THREAD_SUMMARY_SELECT = {
  id: true,
  subject: true,
  lastMessageAt: true,
  createdAt: true,
  ownerReadAt: true,
  adminReadAt: true,
  account: { select: { id: true, name: true } },
};

// A thread is bounded at MAX_THREAD_MESSAGES, so its messages come back whole, oldest first.
const THREAD_SELECT = {
  ...THREAD_SUMMARY_SELECT,
  messages: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { name: true, role: true } },
    },
  },
};

// Threads with a message this side hasn't read: its read time is null or before the last message.
// The comparison is between two columns, hence the field reference.
function unreadWhere(side) {
  const readAt = READ_AT[side];
  return {
    OR: [{ [readAt]: null }, { [readAt]: { lt: prisma.thread.fields.lastMessageAt } }],
  };
}

// The site owner sees only their own threads, so `account` is the admin's alone.
function toThreadSummary(thread, side) {
  const readAt = thread[READ_AT[side]];
  const summary = {
    id: thread.id,
    subject: thread.subject,
    lastMessageAt: thread.lastMessageAt,
    createdAt: thread.createdAt,
    unread: readAt === null || readAt < thread.lastMessageAt,
  };
  return side === 'admin' ? { ...summary, account: thread.account } : summary;
}

function toThread(thread, side) {
  return {
    ...toThreadSummary(thread, side),
    messages: thread.messages.map(({ author, ...message }) => ({
      id: message.id,
      from: author.role,
      authorName: author.name,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}

// One page of threads, newest activity first. Sorted by lastMessageAt, not id, so Prisma's own
// cursor pages from the cursor thread's place in that order; a thread that gets a message while
// paging moves to the top. One row more than the page is read to tell whether another follows.
async function listThreads(where, { limit, cursor }, side) {
  const threads = await prisma.thread.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    take: limit + 1,
    select: THREAD_SUMMARY_SELECT,
  });
  const hasNextPage = threads.length > limit;
  const page = hasNextPage ? threads.slice(0, limit) : threads;
  return {
    data: page.map((thread) => toThreadSummary(thread, side)),
    nextCursor: hasNextPage ? page.at(-1).id : null,
  };
}

// A new thread with its first message and audit event. `side` started it: that side starts read,
// the other unread. accountId is always the site owner's, whoever started it.
async function startThread(tx, req, { accountId, subject, message, side }) {
  const now = new Date();
  const started = await tx.thread.create({
    data: {
      accountId,
      subject,
      lastMessageAt: now,
      [READ_AT[side]]: now,
      messages: { create: { authorId: req.user.id, body: message, createdAt: now } },
    },
    select: { id: true },
  });
  await recordAuditEvent(tx, req, {
    action: AUDIT_ACTIONS.THREAD_STARTED,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'thread',
    targetId: started.id,
  });
  return tx.thread.findUnique({ where: { id: started.id }, select: THREAD_SELECT });
}

// A reply from either side, with its audit event. Updating the thread first locks its row until
// the transaction ends, so two replies at once can't both pass the message cap. The author's own
// read time moves with lastMessageAt, so only the other side sees it as unread.
async function addThreadMessage(tx, req, threadId, side, body) {
  const now = new Date();
  await tx.thread.update({
    where: { id: threadId },
    data: { lastMessageAt: now, [READ_AT[side]]: now },
    select: { id: true },
  });
  const count = await tx.threadMessage.count({ where: { threadId } });
  if (count >= MAX_THREAD_MESSAGES) {
    throw new ServerError(409, 'This thread is full. Start a new thread.');
  }
  await tx.threadMessage.create({
    data: { threadId, authorId: req.user.id, body, createdAt: now },
    select: { id: true },
  });
  await recordAuditEvent(tx, req, {
    action: AUDIT_ACTIONS.THREAD_REPLIED,
    actorId: req.user.id,
    actorEmail: req.user.email,
    targetType: 'thread',
    targetId: threadId,
  });
  return tx.thread.findUnique({ where: { id: threadId }, select: THREAD_SELECT });
}

// Marks a thread read for one side and returns its summary.
async function markThreadRead(threadId, side) {
  const thread = await prisma.thread.update({
    where: { id: threadId },
    data: { [READ_AT[side]]: new Date() },
    select: THREAD_SUMMARY_SELECT,
  });
  return toThreadSummary(thread, side);
}

module.exports = {
  THREAD_NOT_FOUND,
  MAX_THREAD_MESSAGES,
  THREAD_SUMMARY_SELECT,
  THREAD_SELECT,
  unreadWhere,
  toThreadSummary,
  toThread,
  listThreads,
  startThread,
  addThreadMessage,
  markThreadRead,
};
