require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'researchconnect_dev_secret_2026';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Schemas & Models ────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  first_name: { type: String, default: '' },
  last_name: { type: String, default: '' },
  institution: { type: String, default: '' },
  position: { type: String, default: '' },
  bio: { type: String, default: '' },
  research_fields: { type: [String], default: [] },
  h_index: { type: Number, default: 0 },
  total_publications: { type: Number, default: 0 },
  profile_completeness: { type: Number, default: 20 },
  created_at: { type: Date, default: Date.now }
});

const jobSchema = new mongoose.Schema({
  posted_by_user_id: { type: String, required: true },
  organization_name: { type: String, default: 'Organization' },
  title: { type: String, required: true },
  description: { type: String, required: true },
  job_type: { type: String, required: true },
  location: { type: String, default: 'Remote' },
  is_remote: { type: Boolean, default: false },
  salary_min: Number,
  salary_max: Number,
  required_fields: { type: [String], default: [] },
  application_email: { type: String, default: '' },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  expires_at: Date
});

const jobApplicationSchema = new mongoose.Schema({
  job_id: { type: String, required: true },
  user_id: { type: String, required: true },
  message: { type: String, default: '' },
  applied_at: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },
  recipient_id: { type: String, required: true },
  content: { type: String, required: true },
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

const connectionSchema = new mongoose.Schema({
  user_id_1: { type: String, required: true },
  user_id_2: { type: String, required: true },
  status: { type: String, default: 'pending' },
  created_at: { type: Date, default: Date.now }
});

const publicationSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  title: { type: String, required: true },
  authors: { type: [String], default: [] },
  journal_name: { type: String, default: '' },
  publication_date: { type: Date, default: Date.now },
  doi: { type: String, default: '' },
  citation_count: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);
const JobApplication = mongoose.model('JobApplication', jobApplicationSchema);
const Message = mongoose.model('Message', messageSchema);
const Connection = mongoose.model('Connection', connectionSchema);
const Publication = mongoose.model('Publication', publicationSchema);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcCompleteness(user) {
  let c = 0;
  if (user.first_name) c += 10;
  if (user.last_name) c += 10;
  if (user.institution) c += 15;
  if (user.position) c += 15;
  if (user.bio?.length > 50) c += 20;
  if (user.research_fields.length > 0) c += 20;
  if (user.total_publications > 0) c += 10;
  return Math.min(c, 100);
}

function userPublic(u) {
  return { id: u._id, email: u.email, firstName: u.first_name, lastName: u.last_name, institution: u.institution, position: u.position, bio: u.bio, researchFields: u.research_fields, hIndex: u.h_index, totalPublications: u.total_publications, profileCompleteness: u.profile_completeness };
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (await User.findOne({ email })) return res.status(409).json({ message: 'User already exists' });

    const user = await User.create({
      email,
      password_hash: await bcrypt.hash(password, 10),
      first_name: firstName || '',
      last_name: lastName || ''
    });

    const token = jwt.sign({ userId: user._id.toString(), email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registered', token, user: { id: user._id, email, firstName, lastName } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ message: 'Invalid email or password' });

    const token = jwt.sign({ userId: user._id.toString(), email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, user: { id: user._id, email, firstName: user.first_name, lastName: user.last_name } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ user: userPublic(user) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── RESEARCHER ROUTES ────────────────────────────────────────────────────────

app.get('/api/researchers', async (req, res) => {
  try {
    const { search, institution, field, position, limit = 20, offset = 0 } = req.query;
    const query = {};
    if (search) {
      const t = new RegExp(search, 'i');
      query.$or = [{ first_name: t }, { last_name: t }, { bio: t }];
    }
    if (institution) query.institution = new RegExp(institution, 'i');
    if (position) query.position = new RegExp(position, 'i');
    if (field) query.research_fields = new RegExp(field, 'i');

    const total = await User.countDocuments(query);
    const results = await User.find(query).skip(+offset).limit(+limit);
    res.json({ researchers: results.map(userPublic), total, hasMore: (+offset + +limit) < total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/researchers/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json(userPublic(user));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/researchers/:id', auth, async (req, res) => {
  try {
    if (req.user.userId !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Not found' });

    const { firstName, lastName, institution, position, bio, researchFields, hIndex } = req.body;
    if (firstName !== undefined) user.first_name = firstName;
    if (lastName !== undefined) user.last_name = lastName;
    if (institution !== undefined) user.institution = institution;
    if (position !== undefined) user.position = position;
    if (bio !== undefined) user.bio = bio;
    if (researchFields !== undefined) user.research_fields = researchFields;
    if (hIndex !== undefined) user.h_index = hIndex;
    user.profile_completeness = calcCompleteness(user);

    await user.save();
    res.json({ message: 'Profile updated', user: userPublic(user) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── JOB ROUTES ───────────────────────────────────────────────────────────────

app.get('/api/jobs', async (req, res) => {
  try {
    const { jobType, location, field, limit = 20, offset = 0 } = req.query;
    const query = { is_active: true };
    if (jobType) query.job_type = jobType;
    if (location) query.location = new RegExp(location, 'i');
    if (field) query.required_fields = new RegExp(field, 'i');

    const total = await Job.countDocuments(query);
    const results = await Job.find(query).sort({ created_at: -1 }).skip(+offset).limit(+limit);
    res.json({
      jobs: results.map(j => ({ id: j._id, title: j.title, organization: j.organization_name, jobType: j.job_type, location: j.location, salaryMin: j.salary_min, salaryMax: j.salary_max, description: j.description?.substring(0, 200) + '...', requiredFields: j.required_fields, createdAt: j.created_at })),
      total, hasMore: (+offset + +limit) < total
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    const applicantCount = await JobApplication.countDocuments({ job_id: job._id.toString() });
    res.json({ ...job.toObject(), applicantCount });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/jobs', auth, async (req, res) => {
  try {
    const { title, description, jobType, organization, location, isRemote, salaryMin, salaryMax, requiredFields, applicationEmail } = req.body;
    if (!title || !description || !jobType) return res.status(400).json({ message: 'Title, description, jobType required' });
    const expires = new Date(); expires.setDate(expires.getDate() + 30);
    const job = await Job.create({ posted_by_user_id: req.user.userId, organization_name: organization || 'Organization', title, description, job_type: jobType, location: location || 'Remote', is_remote: isRemote || false, salary_min: salaryMin, salary_max: salaryMax, required_fields: requiredFields || [], application_email: applicationEmail || '', expires_at: expires });
    res.status(201).json({ message: 'Job posted', job: { id: job._id, title, jobType } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/jobs/:id', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    if (job.posted_by_user_id !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
    await job.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/jobs/:id/apply', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Not found' });
    const existing = await JobApplication.findOne({ job_id: req.params.id, user_id: req.user.userId });
    if (existing) return res.status(409).json({ message: 'Already applied' });
    await JobApplication.create({ job_id: req.params.id, user_id: req.user.userId, message: req.body.message || '' });
    res.status(201).json({ message: 'Application submitted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── MESSAGE ROUTES ───────────────────────────────────────────────────────────

app.get('/api/messages', auth, async (req, res) => {
  try {
    const myId = req.user.userId;
    const sent = await Message.distinct('recipient_id', { sender_id: myId });
    const received = await Message.distinct('sender_id', { recipient_id: myId });
    const partnerIds = [...new Set([...sent, ...received])];

    const convos = await Promise.all(partnerIds.map(async uid => {
      const msgs = await Message.find({
        $or: [{ sender_id: myId, recipient_id: uid }, { sender_id: uid, recipient_id: myId }]
      }).sort({ created_at: 1 });
      const last = msgs[msgs.length - 1];
      const partner = await User.findById(uid).catch(() => null);
      const unreadCount = msgs.filter(m => m.recipient_id === myId && !m.is_read).length;
      return { userId: uid, userName: partner ? `${partner.first_name} ${partner.last_name}` : uid, lastMessage: last?.content || '', lastMessageTime: last?.created_at, unreadCount };
    }));

    convos.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
    res.json({ conversations: convos, count: convos.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/messages/:userId', auth, async (req, res) => {
  try {
    const myId = req.user.userId;
    const otherId = req.params.userId;
    const msgs = await Message.find({
      $or: [{ sender_id: myId, recipient_id: otherId }, { sender_id: otherId, recipient_id: myId }]
    }).sort({ created_at: 1 });
    await Message.updateMany({ sender_id: otherId, recipient_id: myId }, { is_read: true });
    res.json({ messages: msgs.map(m => ({ id: m._id, senderId: m.sender_id, content: m.content, isRead: m.is_read, createdAt: m.created_at })) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/messages/:userId', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Content required' });
    if (req.user.userId === req.params.userId) return res.status(400).json({ message: 'Cannot message yourself' });
    const msg = await Message.create({ sender_id: req.user.userId, recipient_id: req.params.userId, content });
    res.status(201).json({ message: 'Sent', id: msg._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── CONNECTION ROUTES ────────────────────────────────────────────────────────

app.get('/api/connections', auth, async (req, res) => {
  try {
    const myId = req.user.userId;
    const conns = await Connection.find({ $or: [{ user_id_1: myId }, { user_id_2: myId }], status: 'connected' });
    const ids = conns.map(c => c.user_id_1 === myId ? c.user_id_2 : c.user_id_1);
    res.json({ connections: ids, count: ids.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/connections/pending', auth, async (req, res) => {
  try {
    const pending = await Connection.find({ user_id_2: req.user.userId, status: 'pending' });
    res.json({ pending: pending.map(c => ({ id: c._id, fromUserId: c.user_id_1 })), count: pending.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/connections/:userId/request', auth, async (req, res) => {
  try {
    const myId = req.user.userId;
    const otherId = req.params.userId;
    if (myId === otherId) return res.status(400).json({ message: 'Cannot connect with yourself' });
    const exists = await Connection.findOne({ $or: [{ user_id_1: myId, user_id_2: otherId }, { user_id_1: otherId, user_id_2: myId }] });
    if (exists) return res.status(409).json({ message: 'Connection already exists' });
    const conn = await Connection.create({ user_id_1: myId, user_id_2: otherId });
    res.status(201).json({ message: 'Request sent', id: conn._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/connections/:connectionId', auth, async (req, res) => {
  try {
    const conn = await Connection.findById(req.params.connectionId);
    if (!conn) return res.status(404).json({ message: 'Not found' });
    if (conn.user_id_2 !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
    conn.status = req.body.status === 'accepted' ? 'connected' : 'rejected';
    await conn.save();
    res.json({ message: `Connection ${req.body.status}`, connection: { id: conn._id, status: conn.status } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── PUBLICATION ROUTES ───────────────────────────────────────────────────────

app.get('/api/publications/:userId', async (req, res) => {
  try {
    const pubs = await Publication.find({ user_id: req.params.userId }).sort({ publication_date: -1 });
    res.json({ publications: pubs.map(p => ({ id: p._id, title: p.title, authors: p.authors, journal: p.journal_name, publicationDate: p.publication_date, doi: p.doi, citationCount: p.citation_count })), total: pubs.length });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/publications', auth, async (req, res) => {
  try {
    const { title, authors, journal, publicationDate, doi } = req.body;
    if (!title || !authors) return res.status(400).json({ message: 'Title and authors required' });
    const pub = await Publication.create({ user_id: req.user.userId, title, authors: Array.isArray(authors) ? authors : [authors], journal_name: journal || '', publication_date: publicationDate || new Date(), doi: doi || '' });
    await User.findByIdAndUpdate(req.user.userId, { $inc: { total_publications: 1 } });
    res.status(201).json({ message: 'Publication added', id: pub._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/publications/:id', auth, async (req, res) => {
  try {
    const pub = await Publication.findById(req.params.id);
    if (!pub) return res.status(404).json({ message: 'Not found' });
    if (pub.user_id !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
    await pub.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── PROJECT ROUTES ──────────────────────────────────────────────────────────

const projectSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  field: { type: String, default: '' },
  status: { type: String, enum: ['ongoing', 'completed', 'seeking-collaborators'], default: 'ongoing' },
  created_at: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

app.get('/api/projects', async (req, res) => {
  try {
    const { field, status, userId, limit = 30, offset = 0 } = req.query;
    const query = {};
    if (field) query.field = new RegExp(field, 'i');
    if (status) query.status = status;
    if (userId) query.user_id = userId;
    const total = await Project.countDocuments(query);
    const results = await Project.find(query).sort({ created_at: -1 }).skip(+offset).limit(+limit);
    const projects = await Promise.all(results.map(async p => {
      const owner = await User.findById(p.user_id).catch(() => null);
      return { id: p._id, title: p.title, description: p.description, field: p.field, status: p.status, createdAt: p.created_at, owner: owner ? { id: owner._id, firstName: owner.first_name, lastName: owner.last_name, institution: owner.institution, position: owner.position } : null };
    }));
    res.json({ projects, total, hasMore: (+offset + +limit) < total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const p = await Project.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Not found' });
    const owner = await User.findById(p.user_id).catch(() => null);
    res.json({ id: p._id, title: p.title, description: p.description, field: p.field, status: p.status, createdAt: p.created_at, userId: p.user_id, owner: owner ? { id: owner._id, firstName: owner.first_name, lastName: owner.last_name, institution: owner.institution, position: owner.position } : null });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/projects', auth, async (req, res) => {
  try {
    const { title, description, field, status } = req.body;
    if (!title || !description) return res.status(400).json({ message: 'Title and description required' });
    const project = await Project.create({ user_id: req.user.userId, title, description, field: field || '', status: status || 'ongoing' });
    res.status(201).json({ message: 'Project created', id: project._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/projects/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Not found' });
    if (project.user_id !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
    const { title, description, field, status } = req.body;
    if (title !== undefined) project.title = title;
    if (description !== undefined) project.description = description;
    if (field !== undefined) project.field = field;
    if (status !== undefined) project.status = status;
    await project.save();
    res.json({ message: 'Project updated' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Not found' });
    if (project.user_id !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
    await project.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/projects/:id/collaborate', auth, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Not found' });
    if (project.user_id === req.user.userId) return res.status(400).json({ message: 'Cannot collaborate on your own project' });
    const sender = await User.findById(req.user.userId);
    const senderName = sender ? `${sender.first_name} ${sender.last_name}`.trim() : 'A researcher';
    const content = `Hi! I came across your project "${project.title}" and I'm interested in collaborating. I'd love to discuss how we might work together. Looking forward to hearing from you!`;
    const msg = await Message.create({ sender_id: req.user.userId, recipient_id: project.user_id, content });
    res.status(201).json({ message: 'Collaboration request sent', id: msg._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ─── Serve SPA ────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ResearchConnect running on port ${PORT}`));
