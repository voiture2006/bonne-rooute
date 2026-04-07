const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');

const app = express();

// Configuration depuis les variables d'environnement Render
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cyberlearn_temp_secret_change_in_production';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Sécurité
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Servir les fichiers statiques (index.html à la racine)
app.use(express.static(__dirname)); // ← Changement clé : sert le dossier courant

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ==================== INITIALISATION SQLITE ====================
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('❌ Erreur SQLite:', err);
    else console.log('✅ SQLite connecté');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        password TEXT NOT NULL,
        domain TEXT NOT NULL,
        goal_level TEXT DEFAULT 'debutant',
        progress INTEGER DEFAULT 0,
        completed_videos TEXT DEFAULT '[]',
        last_video_id TEXT DEFAULT NULL,
        last_video_title TEXT DEFAULT NULL,
        chat_history TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        module_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_url TEXT NOT NULL,
        thumbnail TEXT,
        channel_name TEXT,
        duration TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, module_id)
    )`);

    console.log('✅ Tables SQLite prêtes');
});

// ==================== CONFIGURATION YOUTUBE ====================
const moduleConfig = {
    cybersecurite: [
        { module: 1, query: "cybersécurité introduction tutoriel français 2024", keywords: "base sécurité informatique" },
        { module: 2, query: "menaces informatiques virus phishing ransomware explication", keywords: "types de menaces cybersécurité" },
        { module: 3, query: "bonnes pratiques sécurité mot de passe authentification", keywords: "sécurité mot de passe 2FA" }
    ],
    developpement: [
        { module: 1, query: "HTML CSS tutoriel complet débutant 2024", keywords: "apprendre HTML5 CSS3" },
        { module: 2, query: "JavaScript moderne ES6 tutoriel complet", keywords: "JavaScript avancé programmation" },
        { module: 3, query: "React.js tutoriel complet débutant 2024", keywords: "React hooks composants" }
    ],
    domaine: [
        { module: 1, query: "acheter nom de domaine guide complet 2024", keywords: "choisir domaine OVH Gandi" },
        { module: 2, query: "configuration DNS explication simple A CNAME MX", keywords: "DNS enregistrement" },
        { module: 3, query: "hébergement web comparatif 2024 choisir", keywords: "hébergement site web" }
    ]
};

// Recherche de vidéos sur YouTube
async function searchYouTubeVideos(query, maxResults = 1) {
    console.log(`🔍 Recherche YouTube: "${query}"`);
    
    if (!YOUTUBE_API_KEY) {
        console.log('⚠️ Aucune clé API YouTube configurée, utilisation de vidéos démo');
        return getDemoVideos(query);
    }
    
    try {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q: query,
                maxResults: maxResults,
                type: 'video',
                relevanceLanguage: 'fr',
                order: 'relevance',
                key: YOUTUBE_API_KEY
            }
        });

        if (response.data.items && response.data.items.length > 0) {
            console.log(`✅ Trouvé ${response.data.items.length} vidéo(s) pour: ${query}`);
            return response.data.items.map(item => ({
                videoId: item.id.videoId,
                title: item.snippet.title,
                description: item.snippet.description.substring(0, 200),
                thumbnail: item.snippet.thumbnails.high.url,
                channelName: item.snippet.channelTitle,
                videoUrl: `https://www.youtube.com/embed/${item.id.videoId}`
            }));
        }
        console.log(`⚠️ Aucune vidéo trouvée pour: ${query}`);
        return getDemoVideos(query);
    } catch (error) {
        console.error('❌ Erreur YouTube API:', error.response?.data?.error?.message || error.message);
        return getDemoVideos(query);
    }
}

// Vidéos de démonstration
function getDemoVideos(query) {
    const demoVideos = {
        cybersecurite: {
            videoId: 'a8z5QwY8j9E',
            title: '🔒 Cybersécurité - Formation complète pour débutants',
            channelName: 'Formation Cyber'
        },
        developpement: {
            videoId: 'qJ4vL9gKp7M',
            title: '💻 Développement Web - Cours complet HTML/CSS/JS',
            channelName: 'Dev Master'
        },
        domaine: {
            videoId: 'rT5nM2kL9xW',
            title: '🌐 Nom de domaine et hébergement - Guide complet',
            channelName: 'Web Expert'
        }
    };
    
    let type = 'cybersecurite';
    if (query.toLowerCase().includes('html') || query.toLowerCase().includes('css') || query.toLowerCase().includes('javascript')) {
        type = 'developpement';
    } else if (query.toLowerCase().includes('domaine') || query.toLowerCase().includes('hébergement') || query.toLowerCase().includes('dns')) {
        type = 'domaine';
    }
    
    const demo = demoVideos[type];
    return [{
        videoId: demo.videoId,
        title: demo.title,
        description: `Vidéo de formation: ${query.substring(0, 100)}`,
        thumbnail: `https://img.youtube.com/vi/${demo.videoId}/hqdefault.jpg`,
        channelName: demo.channelName,
        videoUrl: `https://www.youtube.com/embed/${demo.videoId}`
    }];
}

// Générer un cours complet
async function generateFullCourse(userId, domain) {
    console.log(`📚 Génération du cours pour l'utilisateur ${userId} dans le domaine: ${domain}`);
    const modules = moduleConfig[domain];
    const generatedCourses = [];

    for (let i = 0; i < modules.length; i++) {
        const config = modules[i];
        console.log(`  → Module ${config.module}: "${config.query}"`);
        const videos = await searchYouTubeVideos(config.query, 1);
        
        if (videos.length > 0) {
            const video = videos[0];
            const courseData = {
                user_id: userId,
                module_id: config.module,
                title: video.title,
                video_id: video.videoId,
                video_url: video.videoUrl,
                thumbnail: video.thumbnail,
                channel_name: video.channelName,
                duration: "15-30 min"
            };

            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO user_courses 
                     (user_id, module_id, title, video_id, video_url, thumbnail, channel_name, duration)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [courseData.user_id, courseData.module_id, courseData.title, 
                     courseData.video_id, courseData.video_url, courseData.thumbnail, 
                     courseData.channel_name, courseData.duration],
                    (err) => { if (err) reject(err); else resolve(); }
                );
            });

            generatedCourses.push({
                id: config.module,
                module_id: config.module,
                title: video.title,
                video_id: video.videoId,
                videoId: video.videoId,
                video_url: video.videoUrl,
                thumbnail: video.thumbnail,
                channel_name: video.channelName
            });
        }
    }
    console.log(`✅ Cours généré avec ${generatedCourses.length} modules`);
    return generatedCourses;
}

// Récupérer les cours d'un utilisateur
function getUserCourses(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM user_courses WHERE user_id = ? ORDER BY module_id',
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// ==================== MIDDLEWARE AUTH ====================
const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        req.userDomain = decoded.domain;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token invalide' });
    }
};

// ==================== ROUTES API ====================

// 1. Chat intelligent
app.post('/api/chat/understand', async (req, res) => {
    const { message } = req.body;
    const lowerMsg = message.toLowerCase();
    
    let response = "";
    let detectedDomain = null;
    let detectedLevel = null;
    
    if (lowerMsg.includes('cyber') || lowerMsg.includes('sécurité') || lowerMsg.includes('securite') || 
        lowerMsg.includes('piratage') || lowerMsg.includes('hack')) {
        detectedDomain = "cybersecurite";
        response = "🔒 Excellent choix ! La cybersécurité est un domaine passionnant. Quel est votre niveau : débutant, intermédiaire ou avancé ?";
    }
    else if (lowerMsg.includes('dev') || lowerMsg.includes('développement') || lowerMsg.includes('code') || 
             lowerMsg.includes('html') || lowerMsg.includes('javascript') || lowerMsg.includes('react')) {
        detectedDomain = "developpement";
        response = "💻 Super ! Le développement web est très demandé. Quel est votre niveau : débutant, intermédiaire ou avancé ?";
    }
    else if (lowerMsg.includes('domaine') || lowerMsg.includes('hébergement') || lowerMsg.includes('hebergement') || 
             lowerMsg.includes('dns') || lowerMsg.includes('nom de domaine')) {
        detectedDomain = "domaine";
        response = "🌐 Parfait ! La gestion des noms de domaine et hébergement est essentielle. Quel est votre niveau : débutant, intermédiaire ou avancé ?";
    }
    else if (lowerMsg.includes('débutant') || lowerMsg.includes('debutant') || lowerMsg.includes('commencer')) {
        detectedLevel = "debutant";
        response = "🎯 Parfait pour commencer ! Quel domaine vous intéresse : cybersécurité, développement web ou noms de domaine ?";
    }
    else if (lowerMsg.includes('intermédiaire') || lowerMsg.includes('intermediaire')) {
        detectedLevel = "intermediaire";
        response = "📚 Très bien ! Niveau intermédiaire. Quel domaine souhaitez-vous approfondir ?";
    }
    else if (lowerMsg.includes('avancé') || lowerMsg.includes('avance') || lowerMsg.includes('expert')) {
        detectedLevel = "avance";
        response = "🚀 Au top ! Niveau avancé. Quel domaine voulez-vous maîtriser ?";
    }
    else {
        response = "👋 Bonjour ! Je suis votre assistant de formation. Dites-moi ce que vous souhaitez apprendre :\n\n• 🔒 Cybersécurité\n• 💻 Développement web\n• 🌐 Noms de domaine et hébergement\n\nQuel domaine vous intéresse ?";
    }
    
    res.json({ response, detectedDomain, detectedLevel });
});

// 2. Générer le cours
app.post('/api/generate-course', async (req, res) => {
    const { domain, level } = req.body;
    if (!domain) return res.status(400).json({ error: "Domaine non spécifié" });
    
    res.json({ 
        success: true, 
        domain, level,
        message: `✅ Parfait ! Créez votre compte pour commencer la formation en ${domain === 'cybersecurite' ? 'Cybersécurité' : domain === 'developpement' ? 'Développement Web' : 'Noms de domaine'} !`
    });
});

// 3. Inscription
app.post('/api/register', async (req, res) => {
    const { name, email, phone, password, domain, goal_level } = req.body;
    
    if (!name || !email || !phone || !password || !domain) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    try {
        const existing = await new Promise((resolve) => {
            db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => resolve(row));
        });
        if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (name, email, phone, password, domain, goal_level, completed_videos)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [name, email, phone, hashedPassword, domain, goal_level || 'debutant', '[]'],
                function(err) { if (err) reject(err); else resolve(this.lastID); }
            );
        });
        
        const courses = await generateFullCourse(result, domain);
        const token = jwt.sign({ id: result, email, domain }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(201).json({
            token,
            user: { id: result, name, email, phone, domain, goal_level, completedVideos: [], progress: 0, lastVideoId: null, lastVideoTitle: null },
            courses
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// 4. Connexion
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const user = await new Promise((resolve) => {
            db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => resolve(row));
        });
        
        if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        
        const courses = await getUserCourses(user.id);
        const completedVideos = JSON.parse(user.completed_videos || '[]');
        const token = jwt.sign({ id: user.id, email: user.email, domain: user.domain }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id, name: user.name, email: user.email, phone: user.phone,
                domain: user.domain, goal_level: user.goal_level, progress: user.progress || 0,
                completedVideos: completedVideos, lastVideoId: user.last_video_id, lastVideoTitle: user.last_video_title
            },
            courses
        });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// 5. Profil
app.get('/api/profile', authMiddleware, async (req, res) => {
    try {
        const user = await new Promise((resolve) => {
            db.get('SELECT id, name, email, phone, domain, goal_level, progress, completed_videos, last_video_id, last_video_title, chat_history FROM users WHERE id = ?', [req.userId], (err, row) => resolve(row));
        });
        if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        
        const courses = await getUserCourses(req.userId);
        res.json({
            user: {
                id: user.id, name: user.name, email: user.email, phone: user.phone,
                domain: user.domain, goal_level: user.goal_level, progress: user.progress || 0,
                completedVideos: JSON.parse(user.completed_videos || '[]'),
                lastVideoId: user.last_video_id, lastVideoTitle: user.last_video_title,
                chatHistory: JSON.parse(user.chat_history || '[]').slice(-20)
            },
            courses
        });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// 6. Progression
app.post('/api/progress', authMiddleware, async (req, res) => {
    const { videoId, videoTitle } = req.body;
    if (!videoId) return res.status(400).json({ error: 'videoId requis' });
    
    try {
        const user = await new Promise((resolve) => {
            db.get('SELECT completed_videos FROM users WHERE id = ?', [req.userId], (err, row) => resolve(row));
        });
        if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        
        let completedVideos = JSON.parse(user.completed_videos || '[]');
        if (!completedVideos.includes(videoId)) {
            completedVideos.push(videoId);
            const courses = await getUserCourses(req.userId);
            const progress = Math.min(Math.round((completedVideos.length / Math.max(courses.length, 1)) * 100), 100);
            
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE users SET completed_videos = ?, progress = ?, last_video_id = ?, last_video_title = ? WHERE id = ?`,
                    [JSON.stringify(completedVideos), progress, videoId, videoTitle || null, req.userId],
                    (err) => { if (err) reject(err); else resolve(); }
                );
            });
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, alreadyCompleted: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// 7. Chat IA
app.post('/api/chat', authMiddleware, async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question requise' });
    
    const knowledgeBase = {
        cybersecurite: {
            responses: ["🔒 La cybersécurité protège vos données. Regardez les vidéos de votre cours pour en savoir plus !", "⚠️ Le phishing est une menace courante. La vidéo sur les menaces vous explique comment vous protéger.", "🛡️ Utilisez des mots de passe forts et l'authentification à deux facteurs."]
        },
        developpement: {
            responses: ["💻 HTML, CSS et JavaScript sont les bases. Les vidéos de votre cours couvrent ces sujets.", "⚛️ React.js est très populaire. La troisième vidéo de votre formation l'introduit.", "🎯 Pratiquez en codant avec les exemples des vidéos pour progresser."]
        },
        domaine: {
            responses: ["🌐 Un nom de domaine est l'adresse de votre site. Les vidéos vous montrent comment le choisir.", "🔄 Les DNS convertissent les noms en adresses IP. C'est expliqué dans la deuxième vidéo.", "☁️ L'hébergement web est crucial. Comparez les offres grâce à la troisième vidéo."]
        }
    };
    
    let userDomain = req.userDomain;
    if (!userDomain) {
        const user = await new Promise((resolve) => {
            db.get('SELECT domain FROM users WHERE id = ?', [req.userId], (err, row) => resolve(row));
        });
        userDomain = user?.domain || 'cybersecurite';
    }
    
    const domainResponses = knowledgeBase[userDomain]?.responses || knowledgeBase.cybersecurite.responses;
    const answer = domainResponses[Math.floor(Math.random() * domainResponses.length)];
    
    const user = await new Promise((resolve) => {
        db.get('SELECT chat_history FROM users WHERE id = ?', [req.userId], (err, row) => resolve(row));
    });
    let chatHistory = JSON.parse(user?.chat_history || '[]');
    chatHistory.push({ question, answer, timestamp: new Date() });
    if (chatHistory.length > 50) chatHistory.shift();
    
    db.run('UPDATE users SET chat_history = ? WHERE id = ?', [JSON.stringify(chatHistory), req.userId]);
    res.json({ answer });
});

// 8. Quiz
const quizzes = {
    cybersecurite: [
        { id: 1, question: "Qu'est-ce qu'un pare-feu ?", options: ["Logiciel antivirus", "Système de filtrage réseau", "Navigateur web", "Langage programmation"], correct: 1 },
        { id: 2, question: "Que signifie HTTPS ?", options: ["Hyper Text Transfer Protocol Secure", "High Tech Secure", "Home Transfer Protocol", "Hyper Secure Transfer"], correct: 0 }
    ],
    developpement: [
        { id: 1, question: "Que signifie HTML ?", options: ["Hyper Text Markup Language", "High Tech Modern Language", "Home Tool Markup Language", "Hyper Transfer Main Language"], correct: 0 },
        { id: 2, question: "React.js est développé par ?", options: ["Google", "Microsoft", "Facebook", "Apple"], correct: 2 }
    ],
    domaine: [
        { id: 1, question: "Qu'est-ce qu'un nom de domaine ?", options: ["Adresse IP", "Adresse web lisible", "Serveur", "Hébergeur"], correct: 1 },
        { id: 2, question: "Que signifie DNS ?", options: ["Domain Name System", "Data Network Service", "Digital Name Server", "Dynamic Name System"], correct: 0 }
    ]
};

app.get('/api/quizzes', authMiddleware, async (req, res) => {
    let userDomain = req.userDomain;
    if (!userDomain) {
        const user = await new Promise((resolve) => {
            db.get('SELECT domain FROM users WHERE id = ?', [req.userId], (err, row) => resolve(row));
        });
        userDomain = user?.domain || 'cybersecurite';
    }
    res.json({ quizzes: quizzes[userDomain] || quizzes.cybersecurite });
});

app.post('/api/quizzes/check', authMiddleware, (req, res) => {
    const { quizId, answer } = req.body;
    let quiz = null;
    for (let domain in quizzes) {
        quiz = quizzes[domain].find(q => q.id === quizId);
        if (quiz) break;
    }
    if (!quiz) return res.status(404).json({ error: 'Quiz non trouvé' });
    res.json({ correct: quiz.correct === answer, correctAnswer: quiz.options[quiz.correct] });
});

// Courses
app.get('/api/courses', authMiddleware, async (req, res) => {
    const courses = await getUserCourses(req.userId);
    res.json({ courses });
});

// Route principale - sert index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Pour toutes les autres routes, servir index.html (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Démarrage
app.listen(PORT, () => {
    console.log(`\n🚀 Serveur CyberLearn démarré sur http://localhost:${PORT}`);
    console.log(`📁 index.html à la racine: ${path.join(__dirname, 'index.html')}`);
    console.log(`📊 Base de données: SQLite`);
    console.log(`📹 YouTube API: ${YOUTUBE_API_KEY ? '✅ Configurée' : '⚠️ Non configurée (mode démo)'}`);
});