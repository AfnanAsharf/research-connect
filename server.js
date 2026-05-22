// ResearchConnect MVP - Single-file server for Replit
// Paste this entire project into Replit (Node.js template)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'researchconnect_dev_secret_2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory Databases ───────────────────────────────────────────────────
const users = {};
const jobs = {};
const messages = [];
const connections = [];
const publications = [];
let userCount = 0, jobCount = 0, msgCount = 0, connCount = 0, pubCount = 0;

// ─── Auth Middleware ────────────────────────────────────────────────────────
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

// ─── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (users[email]) return res.status(409).json({ message: 'User already exists' });

    const userId = `user_${++userCount}`;
    users[email] = {
      id: userId, email,
      password_hash: await bcrypt.hash(password, 10),
      first_name: firstName || '', last_name: lastName || '',
      institution: '', position: '', bio: '',
      research_fields: [], h_index: 0, total_publications: 0,
      profile_completeness: 20, created_at: new Date()
    };

    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registered', token, user: { id: userId, email, firstName, lastName } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users[email];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ message: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, user: { id: user.id, email, firstName: user.first_name, lastName: user.last_name } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = Object.values(users).find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ message: 'Not found' });
  res.json({ user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, institution: user.institution, position: user.position, bio: user.bio, researchFields: user.research_fields, hIndex: user.h_index, profileCompleteness: user.profile_completeness } });
});

// ─── RESEARCHER ROUTES ───────────────────────────────────────────────────────
app.get('/api/researchers', (req, res) => {
  const { search, institution, field, position, limit = 20, offset = 0 } = req.query;
  let results = Object.values(users);

  if (search) {
    const t = search.toLowerCase();
    results = results.filter(u => `${u.first_name} ${u.last_name}`.toLowerCase().includes(t) || u.bio.toLowerCase().includes(t));
  }
  if (institution) results = results.filter(u => u.institution.toLowerCase().includes(institution.toLowerCase()));
  if (position) results = results.filter(u => u.position.toLowerCase().includes(position.toLowerCase()));
  if (field) results = results.filter(u => u.research_fields.some(f => f.toLowerCase().includes(field.toLowerCase())));

  const total = results.length;
  const paged = results.slice(+offset, +offset + +limit);
  res.json({
    researchers: paged.map(u => ({ id: u.id, firstName: u.first_name, lastName: u.last_name, institution: u.institution, position: u.position, bio: u.bio, researchFields: u.research_fields, hIndex: u.h_index, totalPublications: u.total_publications, profileCompleteness: u.profile_completeness })),
    total, hasMore: (+offset + +limit) < total
  });
});

app.get('/api/researchers/:id', (req, res) => {
  const user = Object.values(users).find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'Not found' });
  res.json({ id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, institution: user.institution, position: user.position, bio: user.bio, researchFields: user.research_fields, hIndex: user.h_index, totalPublications: user.total_publications, profileCompleteness: user.profile_completeness });
});

app.put('/api/researchers/:id', auth, (req, res) => {
  if (req.user.userId !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  const user = Object.values(users).find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'Not found' });

  const { firstName, lastName, institution, position, bio, researchFields, hIndex } = req.body;
  if (firstName) user.first_name = firstName;
  if (lastName) user.last_name = lastName;
  if (institution !== undefined) user.institution = institution;
  if (position !== undefined) user.position = position;
  if (bio !== undefined) user.bio = bio;
  if (researchFields) user.research_fields = researchFields;
  if (hIndex !== undefined) user.h_index = hIndex;

  let c = 0;
  if (user.first_name) c += 10; if (user.last_name) c += 10;
  if (user.institution) c += 15; if (user.position) c += 15;
  if (user.bio?.length > 50) c += 20; if (user.research_fields.length > 0) c += 20;
  if (user.total_publications > 0) c += 10;
  user.profile_completeness = Math.min(c, 100);

  res.json({ message: 'Profile updated', user: { id: user.id, firstName: user.first_name, lastName: user.last_name, institution: user.institution, position: user.position, bio: user.bio, researchFields: user.research_fields, hIndex: user.h_index, profileCompleteness: user.profile_completeness } });
});

// ─── JOB ROUTES ──────────────────────────────────────────────────────────────
const jobApplications = [];

app.get('/api/jobs', (req, res) => {
  const { jobType, location, field, limit = 20, offset = 0 } = req.query;
  let results = Object.values(jobs);
  if (jobType) results = results.filter(j => j.job_type === jobType);
  if (location) results = results.filter(j => j.location.toLowerCase().includes(location.toLowerCase()));
  if (field) results = results.filter(j => j.required_fields.some(f => f.toLowerCase().includes(field.toLowerCase())));
  results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = results.length;
  const paged = results.slice(+offset, +offset + +limit);
  res.json({ jobs: paged.map(j => ({ id: j.id, title: j.title, organization: j.organization_name, jobType: j.job_type, location: j.location, salaryMin: j.salary_min, salaryMax: j.salary_max, description: j.description?.substring(0, 200) + '...', requiredFields: j.required_fields, createdAt: j.created_at })), total, hasMore: (+offset + +limit) < total });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Not found' });
  res.json({ ...job, applicantCount: jobApplications.filter(a => a.job_id === job.id).length });
});

app.post('/api/jobs', auth, (req, res) => {
  const { title, description, jobType, organization, location, isRemote, salaryMin, salaryMax, requiredFields, applicationEmail } = req.body;
  if (!title || !description || !jobType) return res.status(400).json({ message: 'Title, description, jobType required' });
  const jobId = `job_${++jobCount}`;
  const expires = new Date(); expires.setDate(expires.getDate() + 30);
  jobs[jobId] = { id: jobId, posted_by_user_id: req.user.userId, organization_name: organization || 'Organization', title, description, job_type: jobType, location: location || 'Remote', is_remote: isRemote || false, salary_min: salaryMin, salary_max: salaryMax, required_fields: requiredFields || [], application_email: applicationEmail || '', is_active: true, created_at: new Date(), expires_at: expires };
  res.status(201).json({ message: 'Job posted', job: { id: jobId, title, jobType } });
});

app.delete('/api/jobs/:id', auth, (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Not found' });
  if (job.posted_by_user_id !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
  delete jobs[req.params.id];
  res.json({ message: 'Deleted' });
});

app.post('/api/jobs/:id/apply', auth, (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Not found' });
  if (jobApplications.some(a => a.job_id === req.params.id && a.user_id === req.user.userId))
    return res.status(409).json({ message: 'Already applied' });
  jobApplications.push({ id: `app_${Date.now()}`, job_id: req.params.id, user_id: req.user.userId, message: req.body.message || '', applied_at: new Date(), status: 'pending' });
  res.status(201).json({ message: 'Application submitted' });
});

// ─── MESSAGE ROUTES ──────────────────────────────────────────────────────────
app.get('/api/messages', auth, (req, res) => {
  const myId = req.user.userId;
  const users2 = new Set();
  messages.forEach(m => { if (m.sender_id === myId) users2.add(m.recipient_id); else if (m.recipient_id === myId) users2.add(m.sender_id); });
  const convos = Array.from(users2).map(uid => {
    const msgs = messages.filter(m => (m.sender_id === myId && m.recipient_id === uid) || (m.sender_id === uid && m.recipient_id === myId));
    const last = msgs[msgs.length - 1];
    // Get partner name
    const partner = Object.values(users).find(u => u.id === uid);
    return { userId: uid, userName: partner ? `${partner.first_name} ${partner.last_name}` : uid, lastMessage: last?.content || '', lastMessageTime: last?.created_at, unreadCount: msgs.filter(m => m.recipient_id === myId && !m.is_read).length };
  }).sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  res.json({ conversations: convos, count: convos.length });
});

app.get('/api/messages/:userId', auth, (req, res) => {
  const myId = req.user.userId;
  const otherId = req.params.userId;
  const convo = messages.filter(m => (m.sender_id === myId && m.recipient_id === otherId) || (m.sender_id === otherId && m.recipient_id === myId)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  messages.forEach(m => { if (m.sender_id === otherId && m.recipient_id === myId) m.is_read = true; });
  res.json({ messages: convo.map(m => ({ id: m.id, senderId: m.sender_id, content: m.content, isRead: m.is_read, createdAt: m.created_at })) });
});

app.post('/api/messages/:userId', auth, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ message: 'Content required' });
  if (req.user.userId === req.params.userId) return res.status(400).json({ message: 'Cannot message yourself' });
  const id = `msg_${++msgCount}`;
  messages.push({ id, sender_id: req.user.userId, recipient_id: req.params.userId, content, is_read: false, created_at: new Date() });
  res.status(201).json({ message: 'Sent', id });
});

// ─── CONNECTION ROUTES ───────────────────────────────────────────────────────
app.get('/api/connections', auth, (req, res) => {
  const myId = req.user.userId;
  const myConns = connections.filter(c => (c.user_id_1 === myId || c.user_id_2 === myId) && c.status === 'connected');
  const ids = myConns.map(c => c.user_id_1 === myId ? c.user_id_2 : c.user_id_1);
  res.json({ connections: ids, count: ids.length });
});

app.get('/api/connections/pending', auth, (req, res) => {
  const myId = req.user.userId;
  const pending = connections.filter(c => c.user_id_2 === myId && c.status === 'pending');
  res.json({ pending: pending.map(c => ({ id: c.id, fromUserId: c.user_id_1 })), count: pending.length });
});

app.post('/api/connections/:userId/request', auth, (req, res) => {
  const myId = req.user.userId;
  const otherId = req.params.userId;
  if (myId === otherId) return res.status(400).json({ message: 'Cannot connect with yourself' });
  if (connections.some(c => (c.user_id_1 === myId && c.user_id_2 === otherId) || (c.user_id_1 === otherId && c.user_id_2 === myId)))
    return res.status(409).json({ message: 'Connection already exists' });
  const id = `conn_${++connCount}`;
  connections.push({ id, user_id_1: myId, user_id_2: otherId, status: 'pending', created_at: new Date() });
  res.status(201).json({ message: 'Request sent', id });
});

app.put('/api/connections/:connectionId', auth, (req, res) => {
  const conn = connections.find(c => c.id === req.params.connectionId);
  if (!conn) return res.status(404).json({ message: 'Not found' });
  if (conn.user_id_2 !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
  conn.status = req.body.status === 'accepted' ? 'connected' : 'rejected';
  res.json({ message: `Connection ${req.body.status}`, connection: { id: conn.id, status: conn.status } });
});

// ─── PUBLICATION ROUTES ──────────────────────────────────────────────────────
app.get('/api/publications/:userId', (req, res) => {
  const pubs = publications.filter(p => p.user_id === req.params.userId).sort((a, b) => new Date(b.publication_date) - new Date(a.publication_date));
  res.json({ publications: pubs.map(p => ({ id: p.id, title: p.title, authors: p.authors, journal: p.journal_name, publicationDate: p.publication_date, doi: p.doi, citationCount: p.citation_count })), total: pubs.length });
});

app.post('/api/publications', auth, (req, res) => {
  const { title, authors, journal, publicationDate, doi } = req.body;
  if (!title || !authors) return res.status(400).json({ message: 'Title and authors required' });
  const id = `pub_${++pubCount}`;
  publications.push({ id, user_id: req.user.userId, title, authors: Array.isArray(authors) ? authors : [authors], journal_name: journal || '', publication_date: publicationDate || new Date(), doi: doi || '', citation_count: 0, created_at: new Date() });
  // Update user publication count
  const user = Object.values(users).find(u => u.id === req.user.userId);
  if (user) user.total_publications++;
  res.status(201).json({ message: 'Publication added', id });
});

app.delete('/api/publications/:id', auth, (req, res) => {
  const idx = publications.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  if (publications[idx].user_id !== req.user.userId) return res.status(403).json({ message: 'Forbidden' });
  publications.splice(idx, 1);
  res.json({ message: 'Deleted' });
});

// ─── Serve SPA ───────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 ResearchConnect running on port ${PORT}`));
