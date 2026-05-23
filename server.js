require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
app.set('trust proxy', 1); // trust Replit's reverse proxy so rate limiters use real client IPs
const JWT_SECRET = process.env.JWT_SECRET || 'researchconnect_dev_secret_2026';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate Limiters ───────────────────────────────────────────────────────────

// Broad safety net: all /api/* routes — 200 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', messages: ['Too many requests from this IP, please try again later'] }
});

// Registration: 5 attempts / 15 min per IP — limits mass account creation
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', messages: ['Too many registration attempts from this IP, please try again in 15 minutes'] }
});

// Login: 10 attempts / 15 min per IP — limits brute-force password guessing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', messages: ['Too many login attempts from this IP, please try again in 15 minutes'] }
});

app.use('/api/', apiLimiter);

// ─── Validation Helpers ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOI_RE   = /^10\.\d{4,}(\.\d+)*\/\S+$/i;

const VALID_JOB_TYPES    = ['postdoc', 'faculty', 'phd', 'industry', 'research-scientist'];
const VALID_CONN_ACTIONS = ['accepted', 'rejected'];
const VALID_PROJ_STATUS  = ['ongoing', 'completed', 'seeking-collaborators'];

// Collect validation errors; return array (empty = valid)
function validateFields(rules) {
  const errors = [];
  for (const { condition, message } of rules) {
    if (condition) errors.push(message);
  }
  return errors;
}

// Send 400 with an array of validation messages
function badRequest(res, errors) {
  const list = Array.isArray(errors) ? errors : [errors];
  return res.status(400).json({ error: 'Validation failed', messages: list });
}

// Centralised error handler — maps Mongoose errors to correct HTTP codes
function handleError(res, err) {
  if (err.name === 'CastError') {
    return res.status(404).json({ error: 'Not found', messages: ['Resource not found'] });
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: 'Validation failed', messages });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({ error: 'Conflict', messages: [`${field} already exists`] });
  }
  console.error(err);
  return res.status(500).json({ error: 'Server error', messages: [err.message] });
}

// Trim all string values in a plain object (one level deep)
function trim(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// Cap pagination params to safe ranges
function pagination(query) {
  const limit  = Math.min(Math.max(parseInt(query.limit)  || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset) || 0, 0);
  return { limit, offset };
}

// ─── Schemas & Models ────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  email:               { type: String, required: true, unique: true },
  password_hash:       { type: String, required: true },
  first_name:          { type: String, default: '' },
  last_name:           { type: String, default: '' },
  institution:         { type: String, default: '' },
  position:            { type: String, default: '' },
  bio:                 { type: String, default: '' },
  research_fields:     { type: [String], default: [] },
  h_index:             { type: Number, default: 0 },
  total_publications:  { type: Number, default: 0 },
  profile_completeness:{ type: Number, default: 20 },
  created_at:          { type: Date, default: Date.now }
});

const jobSchema = new mongoose.Schema({
  posted_by_user_id: { type: String, required: true },
  organization_name: { type: String, default: 'Organization' },
  title:             { type: String, required: true },
  description:       { type: String, required: true },
  job_type:          { type: String, required: true },
  location:          { type: String, default: 'Remote' },
  is_remote:         { type: Boolean, default: false },
  salary_min:        Number,
  salary_max:        Number,
  required_fields:   { type: [String], default: [] },
  application_email: { type: String, default: '' },
  is_active:         { type: Boolean, default: true },
  created_at:        { type: Date, default: Date.now },
  expires_at:        Date
});

const jobApplicationSchema = new mongoose.Schema({
  job_id:    { type: String, required: true },
  user_id:   { type: String, required: true },
  message:   { type: String, default: '' },
  applied_at:{ type: Date, default: Date.now },
  status:    { type: String, default: 'pending' }
});

const messageSchema = new mongoose.Schema({
  sender_id:    { type: String, required: true },
  recipient_id: { type: String, required: true },
  content:      { type: String, required: true },
  is_read:      { type: Boolean, default: false },
  created_at:   { type: Date, default: Date.now }
});

const connectionSchema = new mongoose.Schema({
  user_id_1: { type: String, required: true },
  user_id_2: { type: String, required: true },
  status:    { type: String, default: 'pending' },
  created_at:{ type: Date, default: Date.now }
});

const publicationSchema = new mongoose.Schema({
  user_id:          { type: String, required: true },
  title:            { type: String, required: true },
  authors:          { type: [String], default: [] },
  journal_name:     { type: String, default: '' },
  publication_date: { type: Date, default: Date.now },
  doi:              { type: String, default: '' },
  citation_count:   { type: Number, default: 0 },
  created_at:       { type: Date, default: Date.now }
});

const projectSchema = new mongoose.Schema({
  user_id:    { type: String, required: true },
  title:      { type: String, required: true },
  description:{ type: String, required: true },
  field:      { type: String, default: '' },
  status:     { type: String, enum: VALID_PROJ_STATUS, default: 'ongoing' },
  created_at: { type: Date, default: Date.now }
});

const User        = mongoose.model('User',        userSchema);
const Job         = mongoose.model('Job',         jobSchema);
const JobApplication = mongoose.model('JobApplication', jobApplicationSchema);
const Message     = mongoose.model('Message',     messageSchema);
const Connection  = mongoose.model('Connection',  connectionSchema);
const Publication = mongoose.model('Publication', publicationSchema);
const Project     = mongoose.model('Project',     projectSchema);

// ─── Shared Helpers ───────────────────────────────────────────────────────────

function calcCompleteness(user) {
  let c = 0;
  if (user.first_name) c += 10;
  if (user.last_name)  c += 10;
  if (user.institution) c += 15;
  if (user.position)   c += 15;
  if (user.bio?.length > 50) c += 20;
  if (user.research_fields.length > 0) c += 20;
  if (user.total_publications > 0) c += 10;
  return Math.min(c, 100);
}

function userPublic(u) {
  return {
    id: u._id, email: u.email,
    firstName: u.first_name, lastName: u.last_name,
    institution: u.institution, position: u.position, bio: u.bio,
    researchFields: u.research_fields, hIndex: u.h_index,
    totalPublications: u.total_publications, profileCompleteness: u.profile_completeness
  };
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized', messages: ['No token provided'] });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', messages: ['Invalid or expired token'] });
  }
};

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const { email = '', password = '', firstName = '', lastName = '' } = trim(req.body || {});

    const errors = validateFields([
      { condition: !email,                          message: 'Email is required' },
      { condition: email && !EMAIL_RE.test(email),  message: 'Email address is not valid' },
      { condition: !password,                       message: 'Password is required' },
      { condition: password && password.length < 6, message: 'Password must be at least 6 characters' },
      { condition: password && password.length > 128, message: 'Password must be 128 characters or fewer' },
      { condition: firstName.length > 100,          message: 'First name must be 100 characters or fewer' },
      { condition: lastName.length > 100,           message: 'Last name must be 100 characters or fewer' },
    ]);
    if (errors.length) return badRequest(res, errors);

    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: 'Conflict', messages: ['An account with this email already exists'] });

    const user = await User.create({
      email: email.toLowerCase(),
      password_hash: await bcrypt.hash(password, 10),
      first_name: firstName,
      last_name: lastName
    });

    const token = jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registered', token, user: { id: user._id, email: user.email, firstName, lastName } });
  } catch (e) { handleError(res, e); }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email = '', password = '' } = trim(req.body || {});

    const errors = validateFields([
      { condition: !email,    message: 'Email is required' },
      { condition: !password, message: 'Password is required' },
    ]);
    if (errors.length) return badRequest(res, errors);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Unauthorized', messages: ['Invalid email or password'] });

    const token = jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, user: { id: user._id, email: user.email, firstName: user.first_name, lastName: user.last_name } });
  } catch (e) { handleError(res, e); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Not found', messages: ['User not found'] });
    res.json({ user: userPublic(user) });
  } catch (e) { handleError(res, e); }
});

// ─── RESEARCHER ROUTES ────────────────────────────────────────────────────────

app.get('/api/researchers', async (req, res) => {
  try {
    const { search, institution, field, position } = req.query;
    const { limit, offset } = pagination(req.query);
    const query = {};
    if (search) {
      const t = new RegExp(search.slice(0, 100), 'i');
      query.$or = [{ first_name: t }, { last_name: t }, { bio: t }];
    }
    if (institution) query.institution    = new RegExp(institution.slice(0, 100), 'i');
    if (position)    query.position       = new RegExp(position.slice(0, 100), 'i');
    if (field)       query.research_fields = new RegExp(field.slice(0, 100), 'i');

    const total   = await User.countDocuments(query);
    const results = await User.find(query).skip(offset).limit(limit);
    res.json({ researchers: results.map(userPublic), total, hasMore: (offset + limit) < total });
  } catch (e) { handleError(res, e); }
});

app.get('/api/researchers/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found', messages: ['Researcher not found'] });
    res.json(userPublic(user));
  } catch (e) { handleError(res, e); }
});

app.put('/api/researchers/:id', auth, async (req, res) => {
  try {
    if (req.user.userId !== req.params.id)
      return res.status(403).json({ error: 'Forbidden', messages: ['You can only update your own profile'] });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found', messages: ['Researcher not found'] });

    const { firstName, lastName, institution, position, bio, researchFields, hIndex } = req.body;

    const errors = validateFields([
      { condition: firstName    !== undefined && (typeof firstName !== 'string' || firstName.trim().length > 100),  message: 'First name must be 100 characters or fewer' },
      { condition: lastName     !== undefined && (typeof lastName  !== 'string' || lastName.trim().length  > 100),  message: 'Last name must be 100 characters or fewer' },
      { condition: institution  !== undefined && typeof institution !== 'string',                                   message: 'Institution must be a string' },
      { condition: institution  !== undefined && institution.trim().length > 200,                                   message: 'Institution must be 200 characters or fewer' },
      { condition: position     !== undefined && typeof position !== 'string',                                      message: 'Position must be a string' },
      { condition: position     !== undefined && position.trim().length > 200,                                      message: 'Position must be 200 characters or fewer' },
      { condition: bio          !== undefined && typeof bio !== 'string',                                           message: 'Bio must be a string' },
      { condition: bio          !== undefined && bio.trim().length > 2000,                                          message: 'Bio must be 2000 characters or fewer' },
      { condition: researchFields !== undefined && !Array.isArray(researchFields),                                  message: 'Research fields must be an array' },
      { condition: Array.isArray(researchFields) && researchFields.length > 20,                                     message: 'You can list at most 20 research fields' },
      { condition: hIndex !== undefined && (typeof hIndex !== 'number' || !Number.isInteger(hIndex) || hIndex < 0), message: 'H-index must be a non-negative integer' },
    ]);
    if (errors.length) return badRequest(res, errors);

    if (firstName   !== undefined) user.first_name      = firstName.trim();
    if (lastName    !== undefined) user.last_name       = lastName.trim();
    if (institution !== undefined) user.institution     = institution.trim();
    if (position    !== undefined) user.position        = position.trim();
    if (bio         !== undefined) user.bio             = bio.trim();
    if (researchFields !== undefined) user.research_fields = researchFields.map(f => String(f).trim()).filter(Boolean);
    if (hIndex      !== undefined) user.h_index         = hIndex;
    user.profile_completeness = calcCompleteness(user);

    await user.save();
    res.json({ message: 'Profile updated', user: userPublic(user) });
  } catch (e) { handleError(res, e); }
});

// ─── JOB ROUTES ───────────────────────────────────────────────────────────────

app.get('/api/jobs', async (req, res) => {
  try {
    const { jobType, location, field } = req.query;
    const { limit, offset } = pagination(req.query);
    const query = { is_active: true };
    if (jobType) {
      if (!VALID_JOB_TYPES.includes(jobType))
        return badRequest(res, [`jobType must be one of: ${VALID_JOB_TYPES.join(', ')}`]);
      query.job_type = jobType;
    }
    if (location) query.location       = new RegExp(location.slice(0, 100), 'i');
    if (field)    query.required_fields = new RegExp(field.slice(0, 100), 'i');

    const total   = await Job.countDocuments(query);
    const results = await Job.find(query).sort({ created_at: -1 }).skip(offset).limit(limit);
    res.json({
      jobs: results.map(j => ({
        id: j._id, title: j.title, organization: j.organization_name,
        jobType: j.job_type, location: j.location,
        salaryMin: j.salary_min, salaryMax: j.salary_max,
        description: j.description?.substring(0, 200) + '...',
        requiredFields: j.required_fields, createdAt: j.created_at
      })),
      total, hasMore: (offset + limit) < total
    });
  } catch (e) { handleError(res, e); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found', messages: ['Job not found'] });
    const applicantCount = await JobApplication.countDocuments({ job_id: job._id.toString() });
    res.json({ ...job.toObject(), applicantCount });
  } catch (e) { handleError(res, e); }
});

app.post('/api/jobs', auth, async (req, res) => {
  try {
    const { title = '', description = '', jobType = '', organization = '',
            location = '', isRemote, salaryMin, salaryMax,
            requiredFields, applicationEmail = '' } = req.body || {};

    const errors = validateFields([
      { condition: !title.trim(),       message: 'Job title is required' },
      { condition: title.trim().length > 200, message: 'Title must be 200 characters or fewer' },
      { condition: !description.trim(), message: 'Description is required' },
      { condition: description.trim().length > 10000, message: 'Description must be 10,000 characters or fewer' },
      { condition: !jobType,            message: 'Job type is required' },
      { condition: jobType && !VALID_JOB_TYPES.includes(jobType), message: `jobType must be one of: ${VALID_JOB_TYPES.join(', ')}` },
      { condition: organization.trim().length > 200, message: 'Organization must be 200 characters or fewer' },
      { condition: location.trim().length > 200,     message: 'Location must be 200 characters or fewer' },
      { condition: salaryMin !== undefined && (isNaN(Number(salaryMin)) || Number(salaryMin) < 0), message: 'Salary minimum must be a non-negative number' },
      { condition: salaryMax !== undefined && (isNaN(Number(salaryMax)) || Number(salaryMax) < 0), message: 'Salary maximum must be a non-negative number' },
      { condition: salaryMin !== undefined && salaryMax !== undefined && Number(salaryMin) > Number(salaryMax), message: 'Salary minimum cannot exceed salary maximum' },
      { condition: requiredFields !== undefined && !Array.isArray(requiredFields), message: 'Required fields must be an array' },
      { condition: applicationEmail.trim() && !EMAIL_RE.test(applicationEmail.trim()), message: 'Application email address is not valid' },
    ]);
    if (errors.length) return badRequest(res, errors);

    const expires = new Date(); expires.setDate(expires.getDate() + 30);
    const job = await Job.create({
      posted_by_user_id: req.user.userId,
      organization_name: organization.trim() || 'Organization',
      title: title.trim(), description: description.trim(),
      job_type: jobType, location: location.trim() || 'Remote',
      is_remote: Boolean(isRemote),
      salary_min: salaryMin !== undefined ? Number(salaryMin) : undefined,
      salary_max: salaryMax !== undefined ? Number(salaryMax) : undefined,
      required_fields: Array.isArray(requiredFields) ? requiredFields.map(f => String(f).trim()).filter(Boolean) : [],
      application_email: applicationEmail.trim(),
      expires_at: expires
    });
    res.status(201).json({ message: 'Job posted', job: { id: job._id, title: job.title, jobType } });
  } catch (e) { handleError(res, e); }
});

app.delete('/api/jobs/:id', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found', messages: ['Job not found'] });
    if (job.posted_by_user_id !== req.user.userId)
      return res.status(403).json({ error: 'Forbidden', messages: ['You can only delete your own job listings'] });
    await job.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (e) { handleError(res, e); }
});

app.post('/api/jobs/:id/apply', auth, async (req, res) => {
  try {
    const { message = '' } = req.body || {};
    if (typeof message === 'string' && message.length > 2000)
      return badRequest(res, ['Application message must be 2000 characters or fewer']);

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found', messages: ['Job not found'] });
    if (!job.is_active) return res.status(410).json({ error: 'Gone', messages: ['This job listing is no longer active'] });

    const existing = await JobApplication.findOne({ job_id: req.params.id, user_id: req.user.userId });
    if (existing) return res.status(409).json({ error: 'Conflict', messages: ['You have already applied to this job'] });

    await JobApplication.create({ job_id: req.params.id, user_id: req.user.userId, message: message.trim() });
    res.status(201).json({ message: 'Application submitted' });
  } catch (e) { handleError(res, e); }
});

app.get('/api/jobs/applications/my', auth, async (req, res) => {
  try {
    const apps   = await JobApplication.find({ user_id: req.user.userId }).sort({ applied_at: -1 });
    const jobIds = [...new Set(apps.map(a => a.job_id))];
    const jobs   = await Job.find({ _id: { $in: jobIds } }).select('title organization');
    const jobMap = Object.fromEntries(jobs.map(j => [j._id.toString(), j]));
    res.json({
      applications: apps.map(a => ({
        id:           a._id,
        job_id:       a.job_id,
        job_title:    jobMap[a.job_id]?.title        || 'Unknown Job',
        organization: jobMap[a.job_id]?.organization || '',
        applied_at:   a.applied_at,
        status:       a.status
      }))
    });
  } catch (e) { handleError(res, e); }
});

// ─── MESSAGE ROUTES ───────────────────────────────────────────────────────────

app.get('/api/messages', auth, async (req, res) => {
  try {
    const myId = req.user.userId;
    const sent     = await Message.distinct('recipient_id', { sender_id: myId });
    const received = await Message.distinct('sender_id', { recipient_id: myId });
    const partnerIds = [...new Set([...sent, ...received])];

    const convos = await Promise.all(partnerIds.map(async uid => {
      const msgs = await Message.find({
        $or: [{ sender_id: myId, recipient_id: uid }, { sender_id: uid, recipient_id: myId }]
      }).sort({ created_at: 1 });
      const last    = msgs[msgs.length - 1];
      const partner = await User.findById(uid).catch(() => null);
      const unreadCount = msgs.filter(m => m.recipient_id === myId && !m.is_read).length;
      return {
        userId: uid,
        userName: partner ? `${partner.first_name} ${partner.last_name}` : uid,
        lastMessage: last?.content || '', lastMessageTime: last?.created_at, unreadCount
      };
    }));

    convos.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
    res.json({ conversations: convos, count: convos.length });
  } catch (e) { handleError(res, e); }
});

app.get('/api/messages/:userId', auth, async (req, res) => {
  try {
    const myId    = req.user.userId;
    const otherId = req.params.userId;
    const msgs = await Message.find({
      $or: [{ sender_id: myId, recipient_id: otherId }, { sender_id: otherId, recipient_id: myId }]
    }).sort({ created_at: 1 });
    await Message.updateMany({ sender_id: otherId, recipient_id: myId }, { is_read: true });
    res.json({ messages: msgs.map(m => ({ id: m._id, senderId: m.sender_id, content: m.content, isRead: m.is_read, createdAt: m.created_at })) });
  } catch (e) { handleError(res, e); }
});

app.post('/api/messages/:userId', auth, async (req, res) => {
  try {
    const { content = '' } = req.body || {};
    const errors = validateFields([
      { condition: !content.trim(),         message: 'Message content is required' },
      { condition: content.trim().length > 5000, message: 'Message must be 5,000 characters or fewer' },
      { condition: req.user.userId === req.params.userId, message: 'You cannot message yourself' },
    ]);
    if (errors.length) return badRequest(res, errors);

    const recipient = await User.findById(req.params.userId);
    if (!recipient) return res.status(404).json({ error: 'Not found', messages: ['Recipient not found'] });

    const msg = await Message.create({ sender_id: req.user.userId, recipient_id: req.params.userId, content: content.trim() });
    res.status(201).json({ message: 'Sent', id: msg._id });
  } catch (e) { handleError(res, e); }
});

// ─── CONNECTION ROUTES ────────────────────────────────────────────────────────

app.get('/api/connections', auth, async (req, res) => {
  try {
    const myId  = req.user.userId;
    const conns = await Connection.find({ $or: [{ user_id_1: myId }, { user_id_2: myId }], status: 'connected' });
    const ids   = conns.map(c => c.user_id_1 === myId ? c.user_id_2 : c.user_id_1);
    res.json({ connections: ids, count: ids.length });
  } catch (e) { handleError(res, e); }
});

app.get('/api/connections/pending', auth, async (req, res) => {
  try {
    const pending = await Connection.find({ user_id_2: req.user.userId, status: 'pending' });
    res.json({ pending: pending.map(c => ({ id: c._id, fromUserId: c.user_id_1 })), count: pending.length });
  } catch (e) { handleError(res, e); }
});

app.post('/api/connections/:userId/request', auth, async (req, res) => {
  try {
    const myId    = req.user.userId;
    const otherId = req.params.userId;
    if (myId === otherId)
      return badRequest(res, ['You cannot send a connection request to yourself']);

    const target = await User.findById(otherId);
    if (!target) return res.status(404).json({ error: 'Not found', messages: ['User not found'] });

    const exists = await Connection.findOne({
      $or: [{ user_id_1: myId, user_id_2: otherId }, { user_id_1: otherId, user_id_2: myId }]
    });
    if (exists) return res.status(409).json({ error: 'Conflict', messages: ['A connection with this user already exists'] });

    const conn = await Connection.create({ user_id_1: myId, user_id_2: otherId });
    res.status(201).json({ message: 'Request sent', id: conn._id });
  } catch (e) { handleError(res, e); }
});

app.put('/api/connections/:connectionId', auth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!VALID_CONN_ACTIONS.includes(status))
      return badRequest(res, [`Status must be one of: ${VALID_CONN_ACTIONS.join(', ')}`]);

    const conn = await Connection.findById(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Not found', messages: ['Connection not found'] });
    if (conn.user_id_2 !== req.user.userId)
      return res.status(403).json({ error: 'Forbidden', messages: ['You can only respond to connection requests sent to you'] });
    if (conn.status !== 'pending')
      return res.status(409).json({ error: 'Conflict', messages: ['This connection request has already been responded to'] });

    conn.status = status === 'accepted' ? 'connected' : 'rejected';
    await conn.save();
    res.json({ message: `Connection ${status}`, connection: { id: conn._id, status: conn.status } });
  } catch (e) { handleError(res, e); }
});

// ─── PUBLICATION ROUTES ───────────────────────────────────────────────────────

app.get('/api/publications/:userId', async (req, res) => {
  try {
    const pubs = await Publication.find({ user_id: req.params.userId }).sort({ publication_date: -1 });
    res.json({
      publications: pubs.map(p => ({
        id: p._id, title: p.title, authors: p.authors, journal: p.journal_name,
        publicationDate: p.publication_date, doi: p.doi, citationCount: p.citation_count
      })),
      total: pubs.length
    });
  } catch (e) { handleError(res, e); }
});

app.post('/api/publications', auth, async (req, res) => {
  try {
    const { title = '', authors, journal = '', publicationDate, doi = '' } = req.body || {};
    const authorList = Array.isArray(authors) ? authors : (typeof authors === 'string' ? [authors] : []);

    const errors = validateFields([
      { condition: !title.trim(),              message: 'Publication title is required' },
      { condition: title.trim().length > 500,  message: 'Title must be 500 characters or fewer' },
      { condition: !authorList.length,         message: 'At least one author is required' },
      { condition: authorList.length > 100,    message: 'You can list at most 100 authors' },
      { condition: journal.trim().length > 300, message: 'Journal name must be 300 characters or fewer' },
      { condition: doi.trim() && !DOI_RE.test(doi.trim()), message: 'DOI format is not valid (expected format: 10.xxxx/...)' },
      { condition: publicationDate && isNaN(Date.parse(publicationDate)), message: 'Publication date is not a valid date' },
    ]);
    if (errors.length) return badRequest(res, errors);

    const pub = await Publication.create({
      user_id: req.user.userId,
      title: title.trim(),
      authors: authorList.map(a => String(a).trim()).filter(Boolean),
      journal_name: journal.trim(),
      publication_date: publicationDate ? new Date(publicationDate) : new Date(),
      doi: doi.trim()
    });
    await User.findByIdAndUpdate(req.user.userId, { $inc: { total_publications: 1 } });
    res.status(201).json({ message: 'Publication added', id: pub._id });
  } catch (e) { handleError(res, e); }
});

app.delete('/api/publications/:id', auth, async (req, res) => {
  try {
    const pub = await Publication.findById(req.params.id);
    if (!pub) return res.status(404).json({ error: 'Not found', messages: ['Publication not found'] });
    if (pub.user_id !== req.user.userId)
      return res.status(403).json({ error: 'Forbidden', messages: ['You can only delete your own publications'] });
    await pub.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (e) { handleError(res, e); }
});

// ─── PROJECT ROUTES ───────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    const { field, status, userId } = req.query;
    const { limit, offset } = pagination(req.query);
    const query = {};
    if (field)  query.field    = new RegExp(field.slice(0, 100), 'i');
    if (userId) query.user_id  = userId;
    if (status) {
      if (!VALID_PROJ_STATUS.includes(status))
        return badRequest(res, [`status must be one of: ${VALID_PROJ_STATUS.join(', ')}`]);
      query.status = status;
    }
    const total   = await Project.countDocuments(query);
    const results = await Project.find(query).sort({ created_at: -1 }).skip(offset).limit(limit);
    const projects = await Promise.all(results.map(async p => {
      const owner = await User.findById(p.user_id).catch(() => null);
      return {
        id: p._id, title: p.title, description: p.description, field: p.field,
        status: p.status, createdAt: p.created_at,
        owner: owner ? { id: owner._id, firstName: owner.first_name, lastName: owner.last_name, institution: owner.institution, position: owner.position } : null
      };
    }));
    res.json({ projects, total, hasMore: (offset + limit) < total });
  } catch (e) { handleError(res, e); }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const p = await Project.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found', messages: ['Project not found'] });
    const owner = await User.findById(p.user_id).catch(() => null);
    res.json({
      id: p._id, title: p.title, description: p.description, field: p.field,
      status: p.status, createdAt: p.created_at, userId: p.user_id,
      owner: owner ? { id: owner._id, firstName: owner.first_name, lastName: owner.last_name, institution: owner.institution, position: owner.position } : null
    });
  } catch (e) { handleError(res, e); }
});

app.post('/api/projects', auth, async (req, res) => {
  try {
    const { title = '', description = '', field = '', status = 'ongoing' } = req.body || {};
    const errors = validateFields([
      { condition: !title.trim(),              message: 'Project title is required' },
      { condition: title.trim().length > 200,  message: 'Title must be 200 characters or fewer' },
      { condition: !description.trim(),        message: 'Description is required' },
      { condition: description.trim().length > 10000, message: 'Description must be 10,000 characters or fewer' },
      { condition: field.trim().length > 100,  message: 'Field must be 100 characters or fewer' },
      { condition: !VALID_PROJ_STATUS.includes(status), message: `Status must be one of: ${VALID_PROJ_STATUS.join(', ')}` },
    ]);
    if (errors.length) return badRequest(res, errors);

    const project = await Project.create({
      user_id: req.user.userId,
      title: title.trim(), description: description.trim(),
      field: field.trim(), status
    });
    res.status(201).json({ message: 'Project created', id: project._id });
  } catch (e) { handleError(res, e); }
});

app.put('/api/projects/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found', messages: ['Project not found'] });
    if (project.user_id !== req.user.userId)
      return res.status(403).json({ error: 'Forbidden', messages: ['You can only edit your own projects'] });

    const { title, description, field, status } = req.body || {};
    const errors = validateFields([
      { condition: title       !== undefined && !title.trim(),              message: 'Project title cannot be empty' },
      { condition: title       !== undefined && title.trim().length > 200,  message: 'Title must be 200 characters or fewer' },
      { condition: description !== undefined && !description.trim(),        message: 'Description cannot be empty' },
      { condition: description !== undefined && description.trim().length > 10000, message: 'Description must be 10,000 characters or fewer' },
      { condition: field       !== undefined && field.trim().length > 100,  message: 'Field must be 100 characters or fewer' },
      { condition: status      !== undefined && !VALID_PROJ_STATUS.includes(status), message: `Status must be one of: ${VALID_PROJ_STATUS.join(', ')}` },
    ]);
    if (errors.length) return badRequest(res, errors);

    if (title       !== undefined) project.title       = title.trim();
    if (description !== undefined) project.description = description.trim();
    if (field       !== undefined) project.field       = field.trim();
    if (status      !== undefined) project.status      = status;
    await project.save();
    res.json({ message: 'Project updated' });
  } catch (e) { handleError(res, e); }
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found', messages: ['Project not found'] });
    if (project.user_id !== req.user.userId)
      return res.status(403).json({ error: 'Forbidden', messages: ['You can only delete your own projects'] });
    await project.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (e) { handleError(res, e); }
});

app.post('/api/projects/:id/collaborate', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found', messages: ['Project not found'] });
    if (project.user_id === req.user.userId)
      return badRequest(res, ['You cannot send a collaboration request to your own project']);

    const content = `Hi! I came across your project "${project.title}" and I'm interested in collaborating. I'd love to discuss how we might work together. Looking forward to hearing from you!`;
    const msg = await Message.create({ sender_id: req.user.userId, recipient_id: project.user_id, content });
    res.status(201).json({ message: 'Collaboration request sent', id: msg._id });
  } catch (e) { handleError(res, e); }
});

// ─── Serve SPA ────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ResearchConnect running on port ${PORT}`));
