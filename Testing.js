// ==UserScript==
// @name         Indeed Resume Screener (API)
// @namespace    http://tampermonkey.net/
// @version      9.3.0
// @description  Indeed resume screening with GraphQL API cache + PDF/DOM fallback extraction
// @match        https://employers.indeed.com/*
// @require      https://raw.githubusercontent.com/onth-bot/dsp-shared-ui/main/dsp-ui-core.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @grant        unsafeWindow
// @connect      cdn.jsdelivr.net
// @connect      cdnjs.cloudflare.com
// @inject-into  content
// ==/UserScript==

(function () {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (PAGE._resumeScreener93) return;
    PAGE._resumeScreener93 = true;

    for (let v = 7; v <= 92; v++) {
        delete PAGE[`_resumeScreener${v}`];
        const inst = PAGE[`_screenerInstance${v}`];
        if (inst && typeof inst.destroy === 'function') inst.destroy();
        delete PAGE[`_screenerInstance${v}`];
    }

    const CONFIG = {
        scores: {
            amazonExperience:       20,
            recentWorkHistory2020:  60,
            recentWorkHistory2015:  35,
            deliveryExperience:     20,
            hsGrad2020Plus:         20,
            jobStability:           20,
            physicalActiveWork:     15,
            militaryExperience:     15,
            cleanDrivingRecord:     12,
            hsGrad2014to2019:       10,
            workHistory2010to2014:  10,
            relevantSkills:         10,
            weekendAvailability:    10,
            veryOldWorkHistory:    -100,
            extremeJobHopping:      -85,
            severeJobHopping:       -60,
            criminalRecord:         -75,
            accidentsMentioned:     -53,
            unreliableLanguage:     -38,
            hsGradBefore2010:       -40,
            jobHopping:             -40,
            overqualified:          -30,
            basicResume:            -30,
            truckDrivingCDL:        -30,
            stationaryJob:          -30,
            securityGuard:          -40,
            hsGrad2010to2013:       -20,
            polishedResumeLayout:    10,
            strongResumeLayout:      15,
            entryLevelFit:           10,
            longTenure:              15,
        },
        thresholds: { elite: 100, review: 70, maybe: 40 },
        ui: { subtitle: 'Amazon Delivery · Indeed' },
        timing: { clickActionDelay: 400, unmountGrace: 80 },
        candidateLoad: { pollInterval: 80, maxWait: 8000, stabilityMs: 180, stabilityPoll: 60, stabilityMin: 80 },
        extraction: { apiMin: 100, apiStrong: 300, domMin: 300, maxApiAgeMs: 60000, ocrMaxPages: 2, ocrScale: 2 },
    };

    const KW = {
        amazon:         /\b(?:delivery\s+driver\s*\(?amazon\)?|amazon[\s-]*(?:delivery|driver|dsp)|dsp\b.*?\bdriver)\b/i,
        delivery:       /\b(?:fedex|ups|usps|doordash|uber\s*eats|grubhub|postmates|delivery\s*driver|route\s*driver|courier|package\s*delivery|mail\s*carrier)\b/i,
        skills:         /\b(?:customer\s*service|logistics|routing|package\s*handling|time\s*management|navigation|warehouse|picker|pallet\s*jack|order\s*fulfillment|team\s*leadership)\b/i,
        truckDriving:   /\b(?:truck\s*driver|(?<!non[\s-]*)cdl(?!\s*class\s*c)|commercial\s*driver|semi\s*truck|tractor\s*trailer|big\s*rig|18[\s-]*wheeler|class\s*[ab]\b(?!\s*(?:license|permit))|long\s*haul|over\s*the\s*road|otr\s*driver|flatbed|tanker)\b/i,
        stationaryJobs: /\b(?:secretary|receptionist|administrative\s*assistant|office\s*manager|data\s*entry|clerk|bookkeeper|accountant|front\s*desk|call\s*center|customer\s*support\s*representative|telemarketer|billing|payroll|human\s*resources|hr\s*specialist|recruiter|executive\s*assistant|scheduler|it\s*support|help\s*desk|programmer|software\s*developer|web\s*developer|graphic\s*designer|editor|writer|social\s*media|marketing\s*coordinator)\b/i,
        weekendAvail:   /\b(?:weekends?\s*avail\w*|available\s*weekends?|flexible\s*schedule|open\s*availability|available\s*all\s*days|7\s*days\s*available|work\s*weekends?|saturday\s*(?:and|&)?\s*sunday\s*available|weekend\s*shifts?)\b/i,
        cleanDriving:   /\b(?:clean\s*(?:driving\s*)?record|no\s*(?:accidents|violations)|safe\s*driver|accident[\s-]*free|violation[\s-]*free|spotless\s*record)\b/i,
        physicalWork:   /\b(?:warehouse|loader|unloader|stocker|stocking|construction|landscaping|mover|moving\s*company|retail\s*associate|dock\s*worker|material\s*handler|forklift|heavy\s*lifting|loading\s*dock|physical\s*labor)\b/i,
        military:       /\b(?:military|army|navy|air\s*force|marines|coast\s*guard|national\s*guard|veteran|active\s*duty|reserves|usmc|usaf)\b/i,
        criminal:       /\b(?:criminal\s*(?:record|history)|felony|misdemeanor|conviction|arrested|arrest|probation|parole|expunged)\b/i,
        accidents:      /\b(?:at[\s-]*fault\s*accident|vehicle\s*accident|car\s*accident|collision|crash|traffic\s*accident)\b/i,
        overqualified:  /\b(?:master'?s?\s*degree|mba|ph\.?d|doctorate|doctoral|m\.?d\.?|j\.?d\.?|graduate\s*degree|advanced\s*degree)\b/i,
        unreliable:     /\b(?:seeking\s*temporary|temporary\s*work|short[\s-]*term\s*only|stop[\s-]*gap|interim\s*position|transitional|fill[\s-]*in|temp\s*work|looking\s*for\s*part[\s-]*time\s*only)\b/i,
        securityGuard:  /\b(?:security\s*guard|security\s*officer|patrol\s*(?:security|officer|guard)|armed\s*guard|unarmed\s*guard|loss\s*prevention|bouncer|doorman)\b/i,
    };

    const SEP = '(?:\\s*[-–—~]\\s*|\\s+(?:to|through|thru)\\s+)';
    const MONTH_ALT = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)\\.?';
    const PRESENT_ALT = '(?:present|current|currently|now|ongoing|today)';

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    function textOf(el) {
        return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function findIndeedButton(pathPrefix) {
        return $$('button').find(btn => {
            const path = btn.querySelector('svg path');
            return path && (path.getAttribute('d') || '').startsWith(pathPrefix);
        });
    }

    function waitFor(conditionFn, { interval = 150, timeout = 5000 } = {}) {
        return new Promise(resolve => {
            const start = Date.now();
            const check = () => {
                try {
                    const result = conditionFn();
                    if (result) return resolve(result);
                } catch (e) {}
                if (Date.now() - start >= timeout) return resolve(null);
                setTimeout(check, interval);
            };
            check();
        });
    }

    function getCandidateFingerprint() {
        const nameEl = $('[data-testid="name-plate-name-item"]') || $('[data-testid="candidate-name"]');
        if (nameEl) {
            const name = textOf(nameEl);
            if (name.length > 1) return name;
        }
        const container = $('#candidateProfileContainer');
        if (container) {
            const text = textOf(container).substring(0, 200).trim();
            if (text.length > 20) return text;
        }
        return '';
    }

    function waitForContentStable() {
        const { stabilityMs, stabilityPoll, stabilityMin, maxWait } = CONFIG.candidateLoad;
        return new Promise(resolve => {
            let lastLen = 0;
            let stableAt = Date.now();
            const deadline = Date.now() + maxWait;
            const check = () => {
                const container = $('#candidateProfileContainer');
                const len = container ? textOf(container).length : 0;
                if (len !== lastLen) {
                    lastLen = len;
                    stableAt = Date.now();
                }
                if (len >= stabilityMin && Date.now() - stableAt >= stabilityMs) return resolve(true);
                if (Date.now() >= deadline) return resolve(len >= stabilityMin);
                setTimeout(check, stabilityPoll);
            };
            check();
        });
    }

    async function waitForNewCandidate(previousFingerprint) {
        const { pollInterval, maxWait } = CONFIG.candidateLoad;
        if (previousFingerprint) {
            await waitFor(() => {
                const current = getCandidateFingerprint();
                return current && current !== previousFingerprint;
            }, { interval: pollInterval, timeout: maxWait / 2 });
        }

        const ready = await waitFor(() => {
            const container = $('#candidateProfileContainer');
            if (!container) return false;
            const text = textOf(container);
            if (text.length < 80) return false;
            return $('[data-testid="ProfileResumePanel"]') ||
                   $('[data-testid="ResumePanel_loaded"]') ||
                   $('[data-testid="pdf-resume-view"]') ||
                   text.length > 500;
        }, { interval: pollInterval, timeout: maxWait });

        if (!ready) return false;
        return waitForContentStable();
    }

    function getDomResumeTextLength() {
        const pdf = $('[data-testid="pdf-resume-view"]');
        const loaded = $('[data-testid="ResumePanel_loaded"]');
        const profile = $('[data-testid="ProfileResumePanel"]');
        const container = $('#candidateProfileContainer');
        const pdfSpans = pdf ? $$('span', pdf).filter(s => textOf(s) && (s.offsetWidth || s.offsetHeight)) : [];
        const lengths = [
            pdfSpans.map(s => textOf(s)).join(' ').length,
            textOf(pdf).length,
            textOf(loaded).length,
            textOf(profile).length,
            textOf(container).length,
        ];
        return Math.max(...lengths, 0);
    }

    function hasResumeBlobLink() {
        return $$('a').some(a =>
            a.href?.startsWith('blob:') &&
            /resume|download/i.test(`${a.textContent || ''} ${a.getAttribute('data-testid') || ''}`)
        );
    }

    async function waitForExtractionContent() {
        const start = Date.now();
        const timeout = 6500;
        let lastBest = 0;
        let stableAt = Date.now();

        while (Date.now() - start < timeout) {
            const domLen = getDomResumeTextLength();
            const domName = textOf($('[data-testid="name-plate-name-item"]') || $('[data-testid="candidate-name"]') || $('h1')).toLowerCase();
            const api = API_CACHE.latestCandidate(domName);
            const apiLen = api?.resumeTextChars || 0;
            const best = Math.max(domLen, apiLen);

            if (best !== lastBest) {
                lastBest = best;
                stableAt = Date.now();
            }

            if (domLen >= CONFIG.extraction.domMin) return { ready: true, reason: 'dom', domLen, apiLen };
            if (hasResumeBlobLink() && best >= CONFIG.extraction.apiMin) return { ready: true, reason: 'blob-link', domLen, apiLen };
            if (apiLen >= CONFIG.extraction.apiStrong) return { ready: true, reason: 'api', domLen, apiLen };
            if (best >= CONFIG.extraction.apiMin && Date.now() - stableAt >= 1200) return { ready: true, reason: 'thin-stable', domLen, apiLen };

            await sleep(120);
        }

        return { ready: false, reason: 'timeout', domLen: getDomResumeTextLength(), apiLen: API_CACHE.latestCandidate()?.resumeTextChars || 0 };
    }

    class DiagnosticLogger {
        constructor() { this.entries = []; }
        clear() { this.entries = []; }
        log(category, message, data = null) { this.entries.push({ category, message, data, time: Date.now() }); }
        dump(title = 'DIAGNOSTIC REPORT') {
            console.log(`%c\n╔══════════════════════════════════════════════════╗`, 'color:#f59e0b');
            console.log(`%c║  ${title}`, 'color:#f59e0b;font-weight:bold;font-size:13px');
            console.log(`%c╚══════════════════════════════════════════════════╝`, 'color:#f59e0b');
            const grouped = {};
            for (const e of this.entries) {
                if (!grouped[e.category]) grouped[e.category] = [];
                grouped[e.category].push(e);
            }
            for (const [cat, items] of Object.entries(grouped)) {
                console.log(`%c┌─ ${cat} ─────────────────────────`, 'color:#6366f1;font-weight:bold');
                for (const item of items) {
                    if (item.data !== null && item.data !== undefined) console.log(`%c│  ${item.message}`, 'color:#e2e4ea', item.data);
                    else console.log(`%c│  ${item.message}`, 'color:#e2e4ea');
                }
                console.log(`%c└──────────────────────────────────`, 'color:#6366f1');
            }
        }
    }

    class IndeedApiCache {
        constructor() {
            this.entries = [];
            this.installed = false;
            this.originalFetch = null;
        }

        install() {
            const targetWindow = PAGE || window;
            if (this.installed || typeof targetWindow.fetch !== 'function') return;
            this.installed = true;
            this.originalFetch = targetWindow.fetch;
            const cache = this;

            targetWindow.fetch = function resumeScreenerFetch(input, init = {}) {
                const url = typeof input === 'string' ? input : input?.url;
                const bodySummary = cache.summarizeBody(init?.body);
                const promise = cache.originalFetch.apply(this, arguments);

                if (cache.shouldCapture(url, bodySummary)) {
                    const entry = {
                        time: Date.now(),
                        url: String(url),
                        method: init?.method || 'GET',
                        bodySummary,
                    };
                    cache.entries.push(entry);
                    if (cache.entries.length > 80) cache.entries.shift();

                    promise.then(response => {
                        response.clone().json().then(json => {
                            entry.status = response.status;
                            entry.json = json;
                            entry.candidates = cache.extractCandidatesFromJson(json, entry);
                            console.log('%c[RS API] captured', 'color:#22c55e', {
                                ops: cache.operations(entry).join(', '),
                                candidates: entry.candidates.map(c => c.name || c.resumeName),
                            });
                        }).catch(() => {});
                    }).catch(() => {});
                }
                return promise;
            };
        }

        summarizeBody(body) {
            try {
                if (!body) return null;
                const raw = typeof body === 'string' ? body : JSON.stringify(body);
                const parsed = JSON.parse(raw);
                const items = Array.isArray(parsed) ? parsed : [parsed];
                return items.map(item => ({
                    operationName: item.operationName || null,
                    queryName: String(item.query || '').match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] || null,
                    variableKeys: item.variables ? Object.keys(item.variables) : [],
                }));
            } catch (_) {
                return null;
            }
        }

        operations(entry) {
            return Array.isArray(entry?.bodySummary)
                ? entry.bodySummary.map(x => x.operationName || x.queryName || '').filter(Boolean)
                : [];
        }

        shouldCapture(url, bodySummary) {
            const ops = Array.isArray(bodySummary) ? bodySummary.map(x => x.operationName || x.queryName || '').join(' ') : '';
            return /apis\.indeed\.com\/graphql|employers\.indeed\.com\/graphql/i.test(String(url || '')) &&
                   /CRP_CandidateSubmissions|GetCandidateSubmission|CandidateDetailsIQP/i.test(ops);
        }

        normalizeDateRange(dateRange) {
            if (!dateRange || typeof dateRange !== 'object') return '';
            const fmt = date => {
                if (!date || typeof date !== 'object') return '';
                const month = date.month || date.monthName || '';
                const year = date.year || '';
                return [month, year].filter(Boolean).join(' ');
            };
            const start = fmt(dateRange.fromDate || dateRange.startDate || dateRange.start);
            let end = fmt(dateRange.toDate || dateRange.endDate || dateRange.end);
            if (!end && /Current/i.test(dateRange.__typename || '')) end = 'Present';
            return [start, end].filter(Boolean).join(' - ');
        }

        normalizeTalentRepresentation(talentRepresentation) {
            const tr = talentRepresentation || {};
            const experience = (tr.experience || []).map(exp => ({
                title: exp.title || exp.jobTitle || '',
                company: exp.company || exp.employer || '',
                location: exp.location?.rawLocation || exp.location?.location || '',
                dateRange: this.normalizeDateRange(exp.dateRange),
                description: exp.description || '',
            }));
            const education = (tr.education || []).map(edu => ({
                school: edu.school || edu.institution || edu.name || '',
                degree: edu.degree || edu.field || '',
                location: edu.location?.rawLocation || edu.location?.location || '',
                dateRange: this.normalizeDateRange(edu.dateRange),
            }));
            const skills = (tr.skills || []).map(skill =>
                typeof skill === 'string' ? skill : skill.name || skill.skill || skill.label || ''
            ).filter(Boolean);

            return {
                dataSource: tr.dataSource || null,
                summary: tr.summary || '',
                headline: tr.headline || '',
                experience,
                education,
                skills,
                certifications: tr.certifications || [],
                licenses: tr.licenses || [],
                militaryService: tr.militaryService || [],
            };
        }

        buildResumeText(candidate) {
            const parts = [];
            const profile = candidate?.data?.profile || candidate?.profile || {};
            const tr = candidate.normalizedTalent || this.normalizeTalentRepresentation(candidate?.talentRepresentation || candidate?.data?.talentRepresentation);

            if (profile.name?.displayName) parts.push(profile.name.displayName);
            if (profile.location?.location) parts.push(profile.location.location);
            if (tr.headline) parts.push(tr.headline);
            if (tr.summary) parts.push(tr.summary);

            if (tr.experience.length) {
                parts.push('EXPERIENCE');
                for (const exp of tr.experience) {
                    parts.push([exp.title, exp.company && `at ${exp.company}`, exp.dateRange, exp.location].filter(Boolean).join(' '));
                    if (exp.description) parts.push(exp.description);
                }
            }
            if (tr.education.length) {
                parts.push('EDUCATION');
                for (const edu of tr.education) parts.push([edu.degree, edu.school, edu.dateRange, edu.location].filter(Boolean).join(' '));
            }
            if (tr.skills.length) {
                parts.push('SKILLS');
                parts.push(tr.skills.join(', '));
            }
            return parts.filter(Boolean).join('\n');
        }

        extractCandidatesFromJson(json, entry) {
            const out = [];
            const pushCandidate = raw => {
                if (!raw || typeof raw !== 'object') return;
                const submissionData = raw.data || raw;
                const profile = submissionData.profile || raw.profile || {};
                const tr = this.normalizeTalentRepresentation(raw.talentRepresentation || submissionData.talentRepresentation);
                const candidate = {
                    operation: this.operations(entry).join(','),
                    capturedAt: Date.now(),
                    candidateId: submissionData.candidateIdentity?.candidateId ||
                                 submissionData.candidateIdentity?.candidate?.id ||
                                 raw.candidateId || '',
                    submissionUuid: submissionData.submissionUuid || raw.submissionUuid || '',
                    name: profile.name?.displayName || '',
                    location: profile.location?.location || '',
                    resumeName: submissionData.resume?.name || '',
                    resumeType: submissionData.resume?.__typename || '',
                    submissionCount: Array.isArray(submissionData.candidateIdentity?.candidate?.submissionsConnection?.submissions)
                        ? submissionData.candidateIdentity.candidate.submissionsConnection.submissions.length
                        : null,
                    experience: tr.experience,
                    education: tr.education,
                    skills: tr.skills,
                    normalizedTalent: tr,
                    raw,
                };
                candidate.resumeText = this.buildResumeText({ ...raw, normalizedTalent: tr });
                candidate.resumeTextChars = candidate.resumeText.length;
                out.push(candidate);
            };

            const data = json?.data;
            const results = data?.candidateSubmissions?.results;
            if (Array.isArray(results)) results.forEach(pushCandidate);
            if (data?.candidateSubmission) pushCandidate(data.candidateSubmission);
            if (data?.candidateDetails) pushCandidate(data.candidateDetails);
            return out;
        }

        allCandidates() {
            const out = [];
            for (const entry of this.entries) {
                if (Array.isArray(entry.candidates)) out.push(...entry.candidates);
            }
            return out;
        }

        latestCandidate(nameHint = '') {
            const now = Date.now();
            const hint = String(nameHint || '').toLowerCase().trim();
            let candidates = this.allCandidates()
                .filter(c => now - c.capturedAt <= CONFIG.extraction.maxApiAgeMs)
                .filter(c => /CRP_CandidateSubmissions|GetCandidateSubmission/i.test(c.operation))
                .filter(c => c.name || c.resumeName || c.resumeTextChars || c.experience.length || c.education.length);

            if (hint) {
                const matching = candidates.filter(c => String(c.name || '').toLowerCase().trim() === hint);
                if (matching.length) candidates = matching;
            }
            return candidates.at(-1) || null;
        }
    }

    const API_CACHE = new IndeedApiCache();
    API_CACHE.install();

    class DateParser {
        constructor() {
            this.patterns = [
                new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})${SEP}(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'gi'),
                new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{4})${SEP}(${MONTH_ALT})\\s+(\\d{4})`, 'gi'),
                new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})${SEP}${PRESENT_ALT}`, 'gi'),
                new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{4})${SEP}${PRESENT_ALT}`, 'gi'),
                new RegExp(`\\b(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})${SEP}(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})`, 'gi'),
                new RegExp(`\\b(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})${SEP}${PRESENT_ALT}`, 'gi'),
                new RegExp(`\\b(\\d{1,2})\\/(\\d{4})${SEP}(\\d{1,2})\\/(\\d{4})`, 'gi'),
                new RegExp(`\\b(\\d{1,2})\\/(\\d{4})${SEP}${PRESENT_ALT}`, 'gi'),
                new RegExp(`\\b(\\d{1,2})-(\\d{4})\\s*[-–—~]\\s*(\\d{1,2})-(\\d{4})`, 'gi'),
                new RegExp(`\\b(\\d{1,2})-(\\d{4})\\s+(?:to|through|thru)\\s+(\\d{1,2})-(\\d{4})`, 'gi'),
                new RegExp(`\\b(\\d{1,2})-(\\d{4})${SEP}${PRESENT_ALT}`, 'gi'),
                new RegExp(`\\b(\\d{4})${SEP}(\\d{4})\\b`, 'gi'),
                new RegExp(`\\b(\\d{4})${SEP}${PRESENT_ALT}\\b`, 'gi'),
            ];
            this.configs = [
                { idx: 0, years: [3, 6], isPresent: false },
                { idx: 1, years: [2, 4], isPresent: false },
                { idx: 2, years: [3, 3], isPresent: true },
                { idx: 3, years: [2, 2], isPresent: true },
                { idx: 4, years: [3, 6], isPresent: false },
                { idx: 5, years: [3, 3], isPresent: true },
                { idx: 6, years: [2, 4], isPresent: false },
                { idx: 7, years: [2, 2], isPresent: true },
                { idx: 8, years: [2, 4], isPresent: false },
                { idx: 9, years: [2, 4], isPresent: false },
                { idx: 10, years: [2, 2], isPresent: true },
                { idx: 11, years: [1, 2], isPresent: false },
                { idx: 12, years: [1, 1], isPresent: true },
            ];
        }

        extractAllDates(text) {
            const dates = [];
            const captured = new Set();
            const currentYear = new Date().getFullYear();
            for (const config of this.configs) {
                const pattern = this.patterns[config.idx];
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    const startYear = parseInt(match[config.years[0]]);
                    const endYear = config.isPresent ? currentYear : parseInt(match[config.years[1]]);
                    if (startYear >= 1970 && startYear <= 2030 && endYear >= 1970 && endYear <= 2030) {
                        const key = `${match.index}-${startYear}-${endYear}`;
                        if (!captured.has(key)) {
                            dates.push({ start: startYear, end: endYear, match: match[0], index: match.index });
                            captured.add(key);
                        }
                    }
                }
            }
            return dates;
        }
    }

    function normalizeChunkKey(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 220);
    }

    function compactKey(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
            .slice(0, 180);
    }

    function isLikelyDuplicate(key, compact, seenKeys, seenCompact) {
        if (!key || seenKeys.has(key) || seenCompact.has(compact)) return true;
        for (const existing of seenKeys) {
            if (key.length < 35 || existing.length < 35) continue;
            if (existing.includes(key) || key.includes(existing)) return true;
            const shorter = key.length < existing.length ? key : existing;
            const longer = key.length < existing.length ? existing : key;
            if (shorter.length >= 55 && longer.includes(shorter.slice(0, 55))) return true;
        }
        for (const existing of seenCompact) {
            if (compact.length < 45 || existing.length < 45) continue;
            if (existing.includes(compact) || compact.includes(existing)) return true;
        }
        return false;
    }

    function cleanResumeUiNoise(text) {
        return String(text || '')
            .replace(/\b(?:Set up interview|Message|Call|Resume Download resume|Download resume|Qualifications Required)\b/gi, ' ')
            .replace(/\b(?:Required\s+)?(?:Driver'?s License|Customer service)\b(?=\s+(?:Experience|Education|Resume|[A-Z][a-z]))/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function splitResumeChunks(text) {
        return cleanResumeUiNoise(text)
            .replace(/\s+[•·]\s+/g, '\n')
            .replace(/\s+(EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS|CERTIFICATION|LICENSES|LICENSE|SUMMARY|OBJECTIVE)\s+/gi, '\n$1\n')
            .replace(/\s+((?:\d{1,2}\/\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\s*[–—-]\s*(?:present|current|\d{1,2}\/\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}))/gi, '\n$1')
            .replace(/\s+([A-Z][A-Za-z /&-]{2,45}\s+[–—-]\s+[A-Z][A-Za-z0-9 .,&/-]{2,70}\s+\d{1,2}\/\d{4})/g, '\n$1')
            .split(/[\n.!?]+/)
            .map(x => x.trim().replace(/\s+/g, ' '))
            .filter(x => x.length > 12);
    }

    function mergeResumeSources(sources, { includeLabels = false } = {}) {
        const seen = new Set();
        const seenCompact = new Set();
        const chunks = [];
        const stats = sources.map(source => ({ method: source.method, inputChars: String(source.text || '').length, chunks: 0, kept: 0, duplicate: 0 }));

        sources.forEach((source, sourceIndex) => {
            const parts = splitResumeChunks(source.text);
            stats[sourceIndex].chunks = parts.length;
            for (const part of parts) {
                const key = normalizeChunkKey(part);
                const ckey = compactKey(part);
                if (isLikelyDuplicate(key, ckey, seen, seenCompact)) {
                    stats[sourceIndex].duplicate++;
                    continue;
                }
                seen.add(key);
                if (ckey) seenCompact.add(ckey);
                chunks.push(includeLabels ? `[${source.method}] ${part}` : part);
                stats[sourceIndex].kept++;
            }
        });

        return { text: chunks.join('\n'), chunks, stats, outputChars: chunks.join('\n').length, uniqueChunks: chunks.length };
    }

    class FiberExtractor {
        constructor(diag) {
            this.fragmentData = null;
            this.profile = null;
            this.talentRep = null;
            this.found = false;
            this.diag = diag;
        }

        findFragmentData(obj, depth = 0, visited = new WeakSet()) {
            if (depth > 18 || !obj || typeof obj !== 'object') return null;
            try { if (visited.has(obj)) return null; visited.add(obj); } catch (e) { return null; }
            if (obj.fragmentData && obj.fragmentData.__typename === 'CandidateSubmission') return obj.fragmentData;
            if (obj.memoizedProps?.fragmentData?.__typename === 'CandidateSubmission') return obj.memoizedProps.fragmentData;
            for (const key of ['child', 'sibling', 'return']) {
                if (obj[key]) {
                    const result = this.findFragmentData(obj[key], depth + 1, visited);
                    if (result) return result;
                }
            }
            return null;
        }

        extract() {
            this.found = false;
            this.fragmentData = null;
            this.profile = null;
            this.talentRep = null;
            for (const sel of ['#candidateProfileContainer', '[data-testid="candidate-review-page"]', '[data-testid="namePlate"]']) {
                const el = $(sel);
                const fk = el && Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
                if (!fk) { this.diag.log('FIBER', `Target ${sel}: no React key`); continue; }
                this.fragmentData = this.findFragmentData(el[fk]);
                if (this.fragmentData) {
                    this.diag.log('FIBER', `Found fragmentData via ${sel}`);
                    break;
                }
            }

            if (!this.fragmentData) {
                let scanned = 0;
                for (const el of document.querySelectorAll('div, section, main, article')) {
                    if (scanned++ > 900) break;
                    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'));
                    if (!fk) continue;
                    this.fragmentData = this.findFragmentData(el[fk]);
                    if (this.fragmentData) {
                        this.diag.log('FIBER', `Found fragmentData via broad scan #${scanned}`);
                        break;
                    }
                }
            }

            if (!this.fragmentData) {
                this.diag.log('FIBER', 'No Fiber data found');
                return this;
            }

            this.found = true;
            const data = this.fragmentData.data || this.fragmentData;
            this.profile = data.profile || null;
            this.talentRep = this.fragmentData.talentRepresentation || null;
            return this;
        }

        getName() { return this.profile?.name?.displayName || null; }
        hasStructuredResume() { return !!this.talentRep && this.talentRep.dataSource !== 'NONE' && ((this.talentRep.experience?.length || 0) || (this.talentRep.education?.length || 0) || (this.talentRep.skills?.length || 0)); }
        getExperience() { return this.talentRep?.experience || []; }
        getEducation() { return this.talentRep?.education || []; }
        getSkills() { return this.talentRep?.skills || []; }
        getSubmissionCount() {
            const subs = this.fragmentData?.data?.candidateIdentity?.candidate?.submissionsConnection?.submissions;
            return Array.isArray(subs) ? subs.length : 0;
        }
    }

    class Extractor {
        constructor(diag) {
            this.diag = diag;
            this.fiber = new FiberExtractor(diag);
            this.text = '';
            this.method = 'none';
            this.charCount = 0;
            this.candidateName = null;
            this.apiCandidate = null;
            this.hasFiberStructured = false;
            this.mergeStats = [];
            this.imageOnlyPdf = false;
        }

        extractDomResume() {
            const pdf = $('[data-testid="pdf-resume-view"]');
            const loaded = $('[data-testid="ResumePanel_loaded"]');
            const profile = $('[data-testid="ProfileResumePanel"]');
            const container = $('#candidateProfileContainer');
            const pdfSpans = pdf ? $$('span', pdf).filter(s => textOf(s) && (s.offsetWidth || s.offsetHeight)) : [];
            const pdfSpanText = pdfSpans.map(s => textOf(s)).join(' ');
            const candidates = [
                { method: 'PDF-Spans', text: pdfSpanText },
                { method: 'PDF', text: textOf(pdf) },
                { method: 'ResumePanel', text: textOf(loaded) },
                { method: 'ProfileResumePanel', text: textOf(profile) },
                { method: 'Container', text: textOf(container) },
            ].filter(s => s.text && s.text.length >= 80);

            candidates.sort((a, b) => b.text.length - a.text.length);
            const best = candidates[0] || { method: 'DOM', text: '' };
            this.diag.log('DOM', `Best DOM source ${best.method}: ${best.text.length} chars; PDF spans ${pdfSpans.length}`);
            return best;
        }

        async extractPdfBlobText() {
            const pdfjs = window.pdfjsLib || PAGE.pdfjsLib || window.pdfjsDistBuildPdf || PAGE.pdfjsDistBuildPdf || window.PDFJS || PAGE.PDFJS;
            if (!pdfjs?.getDocument) {
                this.diag.log('PDF-BLOB', 'PDF.js getDocument not available');
                console.warn('[RS PDF-BLOB] PDF.js getDocument not available', { pdfjs, windowPdfjsLib: window.pdfjsLib, pagePdfjsLib: PAGE.pdfjsLib });
                return { method: 'PDF-Blob', text: '' };
            }

            const links = $$('a').filter(a =>
                a.href?.startsWith('blob:') &&
                /resume|download/i.test(`${a.textContent || ''} ${a.getAttribute('data-testid') || ''}`)
            );
            const href = links[0]?.href;
            if (!href) {
                this.diag.log('PDF-BLOB', 'No blob resume link found');
                console.warn('[RS PDF-BLOB] No blob resume link found', $$('a').map(a => ({
                    text: textOf(a),
                    testid: a.getAttribute('data-testid'),
                    href: a.href
                })).filter(a => /resume|download|blob/i.test(`${a.text} ${a.testid} ${a.href}`)));
                return { method: 'PDF-Blob', text: '' };
            }

            try {
                console.log('[RS PDF-BLOB] Fetching blob resume', href);
                const response = await fetch(href);
                const data = new Uint8Array(await response.arrayBuffer());
                const header = [...data.slice(0, 4)].map(b => String.fromCharCode(b)).join('');
                if (header !== '%PDF') {
                    this.diag.log('PDF-BLOB', `Blob is not a PDF header=${header}`);
                    console.warn('[RS PDF-BLOB] Blob is not a PDF', { status: response.status, type: response.headers.get('content-type'), bytes: data.length, header });
                    return { method: 'PDF-Blob', text: '' };
                }

                const loadingTask = pdfjs.getDocument({ data });
                const pdf = await loadingTask.promise;
                const pages = [];
                const maxPages = Math.min(pdf.numPages || 1, 6);
                for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
                    const page = await pdf.getPage(pageNo);
                    const content = await page.getTextContent();
                    const items = (content.items || []).map(item => item.str || '').filter(Boolean);
                    pages.push(items.join(' '));
                }

                const text = pages.join('\n').replace(/\s+/g, ' ').trim();
                this.diag.log('PDF-BLOB', `Parsed ${pdf.numPages} pages, ${text.length} chars`);
                console.log('[RS PDF-BLOB] Parsed PDF text', { pages: pdf.numPages, chars: text.length, preview: text.slice(0, 500) });
                if (text.length < CONFIG.extraction.domMin) {
                    const ocrText = await this.ocrPdf(pdf);
                    if (ocrText.length > text.length) return { method: 'PDF-OCR', text: ocrText };
                    this.diag.log('PDF-BLOB', 'PDF has little/no embedded text and OCR returned no usable text');
                    this.imageOnlyPdf = true;
                }
                return { method: 'PDF-Blob', text };
            } catch (error) {
                this.diag.log('PDF-BLOB', `Parse failed: ${error.message || error}`);
                console.error('[RS PDF-BLOB] Parse failed', error);
                return { method: 'PDF-Blob', text: '' };
            }
        }

        async ocrPdf(pdf) {
            if (!window.Tesseract?.recognize) {
                this.diag.log('PDF-OCR', 'Tesseract.js not available');
                console.warn('[RS PDF-OCR] Tesseract.js not available', { tesseract: window.Tesseract });
                return '';
            }

            const pageCount = Math.min(pdf.numPages || 1, CONFIG.extraction.ocrMaxPages);
            const texts = [];
            this.diag.log('PDF-OCR', `Starting OCR for ${pageCount} page(s)`);
            console.log('[RS PDF-OCR] Starting OCR', { pageCount });

            for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
                try {
                    const page = await pdf.getPage(pageNo);
                    const viewport = page.getViewport({ scale: CONFIG.extraction.ocrScale });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    canvas.width = Math.floor(viewport.width);
                    canvas.height = Math.floor(viewport.height);

                    await page.render({ canvasContext: context, viewport }).promise;
                    const result = await window.Tesseract.recognize(canvas, 'eng', {
                        logger: msg => {
                            if (msg.status === 'recognizing text') {
                                console.log('[RS PDF-OCR]', `page ${pageNo}`, `${Math.round((msg.progress || 0) * 100)}%`);
                            }
                        },
                    });
                    const pageText = (result?.data?.text || '').replace(/\s+/g, ' ').trim();
                    texts.push(pageText);
                    this.diag.log('PDF-OCR', `Page ${pageNo}: ${pageText.length} chars`);
                    console.log('[RS PDF-OCR] Page complete', { pageNo, chars: pageText.length, preview: pageText.slice(0, 300) });
                } catch (error) {
                    this.diag.log('PDF-OCR', `Page ${pageNo} failed: ${error.message || error}`);
                    console.error('[RS PDF-OCR] Page failed', pageNo, error);
                }
            }

            const text = texts.join('\n').replace(/\s+/g, ' ').trim();
            this.diag.log('PDF-OCR', `OCR complete: ${text.length} chars`);
            console.log('[RS PDF-OCR] OCR complete', { chars: text.length, preview: text.slice(0, 700) });
            return text;
        }


        buildFromFiber() {
            const parts = [];
            const tr = this.fiber.talentRep;
            if (!tr) return '';
            if (tr.summary) parts.push(tr.summary);
            if (tr.headline) parts.push(tr.headline);
            if (tr.experience?.length) {
                parts.push('EXPERIENCE');
                for (const exp of tr.experience) {
                    const title = exp.title || exp.jobTitle || '';
                    const company = exp.company || exp.employer || '';
                    const desc = exp.description || '';
                    const dr = exp.dateRange;
                    let startStr = '', endStr = '';
                    if (dr?.fromDate) startStr = [dr.fromDate.month, dr.fromDate.year].filter(Boolean).join(' ');
                    if (dr?.toDate) endStr = [dr.toDate.month, dr.toDate.year].filter(Boolean).join(' ');
                    if (dr?.__typename === 'TalentRepresentationDateRangeCurrent' || !dr?.toDate) endStr = endStr || 'Present';
                    const loc = exp.location?.rawLocation || exp.location?.location || '';
                    parts.push(`${title} at ${company} ${startStr} - ${endStr} ${loc}`.trim());
                    if (desc) parts.push(desc);
                }
            }
            if (tr.education?.length) {
                parts.push('EDUCATION');
                for (const edu of tr.education) {
                    const school = edu.school || edu.institution || edu.name || '';
                    const degree = edu.degree || edu.field || '';
                    const dr = edu.dateRange;
                    const date = [dr?.fromDate?.year, dr?.toDate?.year].filter(Boolean).join(' - ');
                    parts.push(`${degree} ${school} ${date}`.trim());
                }
            }
            if (tr.skills?.length) {
                parts.push('SKILLS');
                parts.push(tr.skills.map(s => typeof s === 'string' ? s : s.name || s.skill || s.label || '').filter(Boolean).join(', '));
            }
            return parts.join('\n');
        }

        async extract() {
            const domName = textOf($('[data-testid="name-plate-name-item"]') || $('[data-testid="candidate-name"]') || $('h1'));
            this.apiCandidate = API_CACHE.latestCandidate(domName.toLowerCase());
            if (this.apiCandidate) {
                this.candidateName = this.apiCandidate.name || domName || null;
                this.diag.log('API', `Candidate ${this.apiCandidate.name || 'unknown'}: ${this.apiCandidate.resumeTextChars} API chars, exp ${this.apiCandidate.experience.length}, edu ${this.apiCandidate.education.length}`);
            } else {
                this.candidateName = domName || null;
                this.diag.log('API', 'No matching API candidate found');
            }

            const dom = this.extractDomResume();
            const blob = dom.text.length >= CONFIG.extraction.domMin ? { method: 'PDF-Blob', text: '' } : await this.extractPdfBlobText();
            const sources = [];
            const apiText = this.apiCandidate?.resumeText || '';
            if (apiText.length >= CONFIG.extraction.apiMin) sources.push({ method: 'API', text: apiText });
            if (blob.text.length >= 80) sources.push(blob);
            if (dom.text.length >= 80) sources.push({ method: dom.method, text: dom.text });

            if (sources.length === 0) {
                this.fiber.extract();
                this.hasFiberStructured = this.fiber.hasStructuredResume();
                if (!this.candidateName) this.candidateName = this.fiber.getName() || domName || null;
                const fiberText = this.hasFiberStructured ? this.buildFromFiber() : '';
                if (fiberText.length >= 80) sources.push({ method: 'Fiber', text: fiberText });
            }

            if (sources.length === 0) {
                const containerText = textOf($('#candidateProfileContainer') || document.body);
                if (containerText.length >= 80) sources.push({ method: 'Container', text: containerText });
            }

            if (sources.length === 0) {
                this.text = '';
                this.method = 'Insufficient';
                this.charCount = 0;
                return '';
            }

            let chosenMethod;
            const apiStrong = apiText.length >= CONFIG.extraction.apiStrong;
            const pdfStrong = Math.max(dom.text.length, blob.text.length) >= CONFIG.extraction.domMin;
            if (apiStrong && pdfStrong) chosenMethod = 'API+PDF';
            else if (blob.text.length >= CONFIG.extraction.domMin) chosenMethod = blob.method;
            else if (dom.text.length >= CONFIG.extraction.domMin) chosenMethod = dom.method;
            else if (apiText.length >= CONFIG.extraction.apiMin) chosenMethod = 'API';
            else chosenMethod = sources.map(s => s.method).join('+');

            const merged = mergeResumeSources(sources);
            this.text = merged.text;
            this.method = chosenMethod;
            this.charCount = this.text.length;
            this.mergeStats = merged.stats;
            this.diag.log('MERGE', `${chosenMethod}: ${sources.map(s => `${s.method}(${s.text.length})`).join(' + ')} => ${this.charCount} chars`, merged.stats);
            console.log(`%c📄 Extraction [${this.method}]: ${this.charCount.toLocaleString()} chars`, 'color:#6366f1', merged.stats);
            return this.text;
        }
    }

    function analyzeText(rawText, extractor, diag) {
        const S = CONFIG.scores;
        const result = { score: 0, pos: {}, neg: {}, debug: {} };
        const text = rawText.replace(/applied\s+to:\s*[^\n]+/gi, '').replace(/accepts?\s+push[^\n]*/gi, '');
        const lower = text.toLowerCase();

        if (lower.length < 100) {
            result.neg['Insufficient Data'] = 0;
            diag.log('ANALYZE', 'Insufficient text');
            return result;
        }

        const add = (label, pts, trigger = '') => {
            result.score += pts;
            if (pts >= 0) result.pos[label] = pts;
            else result.neg[label] = pts;
            const msg = `${pts >= 0 ? '✅' : '🚩'} ${label}: ${pts > 0 ? '+' : ''}${pts}${trigger ? ` ← "${trigger}"` : ''}`;
            console.log(msg);
            diag.log('SCORE', msg);
        };

        console.log('%c═══ RESUME ANALYSIS v9.3 ═══', 'font-weight:bold;color:#6366f1;font-size:13px');

        const amazonMatch = lower.match(KW.amazon);
        if (amazonMatch) add('Amazon Delivery', S.amazonExperience, amazonMatch[0]);
        const deliveryMatch = lower.match(KW.delivery);
        if (!amazonMatch && deliveryMatch) add('Delivery Experience', S.deliveryExperience, deliveryMatch[0]);

        const checks = [
            [KW.cleanDriving,   'Clean Driving Record',  S.cleanDrivingRecord],
            [KW.physicalWork,   'Physical Work Exp',      S.physicalActiveWork],
            [KW.military,       'Military Background',    S.militaryExperience],
            [KW.skills,         'Relevant Skills',        S.relevantSkills],
            [KW.weekendAvail,   'Weekend Availability',   S.weekendAvailability],
            [KW.stationaryJobs, 'Office/Stationary Job',  S.stationaryJob],
            [KW.criminal,       'Criminal Record',        S.criminalRecord],
            [KW.accidents,      'Accidents Mentioned',    S.accidentsMentioned],
            [KW.overqualified,  'Overqualified',          S.overqualified],
            [KW.unreliable,     'Temporary/Short-term',   S.unreliableLanguage],
        ];
        for (const [regex, label, pts] of checks) {
            const match = lower.match(regex);
            if (match) add(label, pts, match[0]);
        }

        const workOnlyText = lower
            .replace(/certifications?\s*(?:&|and)?\s*licenses?[\s\S]{0,500}?(?=experience|education|skills|work|summary|objective|$)/gi, '')
            .replace(/licenses?\s*(?:&|and)?\s*certifications?[\s\S]{0,500}?(?=experience|education|skills|work|summary|objective|$)/gi, '');
        const truckMatch = workOnlyText.match(KW.truckDriving);
        if (truckMatch) add('Truck Driving/CDL', S.truckDrivingCDL, truckMatch[0]);

        let securityJobCount = 0;
        if (extractor?.apiCandidate?.experience?.length) {
            for (const exp of extractor.apiCandidate.experience) {
                if (KW.securityGuard.test(`${exp.title || ''} ${exp.company || ''}`.toLowerCase())) securityJobCount++;
            }
        } else if (extractor?.fiber?.hasStructuredResume()) {
            for (const exp of extractor.fiber.getExperience()) {
                if (KW.securityGuard.test((exp.title || exp.jobTitle || '').toLowerCase())) securityJobCount++;
            }
        }
        if (securityJobCount === 0 && KW.securityGuard.test(lower)) securityJobCount = 1;
        if (securityJobCount > 0) add(`Security Guard (×${securityJobCount})`, securityJobCount * S.securityGuard, `${securityJobCount} jobs`);

        const quality = assessQuality(rawText, !!(extractor?.apiCandidate?.resumeTextChars >= CONFIG.extraction.apiStrong));
        diag.log('ANALYZE', `Resume quality: ${quality}`);
        if (quality === 'basic') add('Poor/Basic Resume', S.basicResume);

        const visualPolish = assessVisualPolish();
        diag.log('ANALYZE', `Visual polish: ${visualPolish.tier} (${visualPolish.score})`, visualPolish.metrics);
        if (visualPolish.tier === 'strong') add('Strong Resume Layout', S.strongResumeLayout);
        else if (visualPolish.tier === 'polished') add('Polished Resume Layout', S.polishedResumeLayout);

        const hsYear = extractHSGradYear(text);
        if (hsYear > 0) {
            if (hsYear >= 2020) add('HS Grad 2020+', S.hsGrad2020Plus);
            else if (hsYear >= 2014) add('HS Grad 2014-2019', S.hsGrad2014to2019);
            else if (hsYear >= 2010) add('HS Grad 2010-2013', S.hsGrad2010to2013);
            else add('HS Grad Before 2010', S.hsGradBefore2010);
        }

        const wh = analyzeWorkHistory(text);
        result.debug.workHistory = wh;
        if (wh.earliest > 0) {
            if (wh.earliest >= 2020) add('Started 2020+', S.recentWorkHistory2020);
            else if (wh.earliest >= 2015) add('Started 2015-2019', S.recentWorkHistory2015);
            else if (wh.earliest >= 2010) add('Started 2010-2014', S.workHistory2010to2014);
            else add('Started Before 2010', S.veryOldWorkHistory);
        }
        if (wh.stable) add('Job Stability', S.jobStability);
        else if (wh.extremeHopper) add('Extreme Job Hopping', S.extremeJobHopping, wh.hopperDetails);
        else if (wh.severeHopper) add('Severe Job Hopping', S.severeJobHopping, wh.hopperDetails);
        else if (wh.hopper) add('Job Hopping', S.jobHopping, wh.hopperDetails);

        if (wh.longTenure) add('Long Tenure', S.longTenure, wh.longTenureDetails);

        const hasEntryRelevantExp = KW.physicalWork.test(lower) || KW.delivery.test(lower) || KW.skills.test(lower);
        const hasHeavyExperienceSignal = KW.overqualified.test(lower) || KW.truckDriving.test(workOnlyText);
        if (
            wh.count > 0 &&
            wh.count <= 4 &&
            wh.earliest >= new Date().getFullYear() - 7 &&
            hasEntryRelevantExp &&
            !hasHeavyExperienceSignal
        ) {
            add('Entry-Level Fit', S.entryLevelFit);
        }

        console.log(`%c═══ SCORE: ${result.score} ═══`, 'font-weight:bold;font-size:14px;color:' +
            (result.score >= 100 ? '#22c55e' : result.score >= 70 ? '#eab308' : '#ef4444'));
        return result;
    }

    function analyzeWorkHistory(fullText) {
        const parser = new DateParser();
        let workText = fullText.toLowerCase();
        const eduHeaders = /\b(?:education(?:\s+and\s+training)?|academic\s+background)\b/gi;
        const sectionHeaders = /\b(?:experience|work\s+history|employment|professional|skills|certifications?|summary|objective|projects?|volunteer|references?)\b/gi;
        const eduPositions = [];
        let m;
        while ((m = eduHeaders.exec(workText)) !== null) eduPositions.push(m.index);
        for (const eduStart of eduPositions.reverse()) {
            sectionHeaders.lastIndex = eduStart + 10;
            const nextSection = sectionHeaders.exec(workText);
            const eduEnd = nextSection ? nextSection.index : Math.min(eduStart + 1500, workText.length);
            workText = workText.substring(0, eduStart) + ' '.repeat(eduEnd - eduStart) + workText.substring(eduEnd);
        }
        workText = workText.replace(/high\s+school[^\n]{0,150}?(?:\d{4}|diploma|ged)/gi, ' ');
        workText = workText.replace(/(?:attended|graduated|diploma|ged|degree)[^\n]{0,150}?\d{4}/gi, ' ');
        workText = workText.replace(/\buniversity\b[^\n]{0,150}?\d{4}/gi, ' ');
        workText = workText.replace(/\bcollege\b[^\n]{0,150}?\d{4}/gi, ' ');

        const currentYear = new Date().getFullYear();
        const allDates = parser.extractAllDates(workText);
        const seen = new Set();
        const jobs = allDates.filter(d => {
            if (d.start < 1990 || d.start > currentYear) return false;
            if (d.end < d.start || d.end > currentYear) return false;
            if ((d.end - d.start) < 0.08 && d.end !== currentYear) return false;
            const key = `${d.start}-${d.end}-${normalizeChunkKey(workText.slice(Math.max(0, d.index - 80), d.index + 120)).slice(0, 80)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).map(d => ({ start: d.start, end: d.end, duration: d.end - d.start, match: d.match }));

        if (jobs.length === 0) return { earliest: 0, stable: false, longTenure: false, hopper: false, severeHopper: false, extremeHopper: false, count: 0, allJobs: [], hopperDetails: '', longTenureDetails: '' };
        const earliest = Math.min(...jobs.map(d => d.start));
        const stable = jobs.some(j => j.duration >= 2);
        const longestJob = jobs.reduce((best, job) => job.duration > best.duration ? job : best, jobs[0]);
        const longTenure = longestJob.duration >= 3;
        const longTenureDetails = longTenure ? `${longestJob.duration.toFixed(1)}yr (${longestJob.start}-${longestJob.end})` : '';
        const under6Months = jobs.filter(j => j.duration < 0.5).length;
        const under1Year = jobs.filter(j => j.duration < 1).length;
        const under2Years = jobs.filter(j => j.duration < 2).length;
        const extremeHopper = under6Months >= 3;
        const severeHopper = !extremeHopper && (under6Months >= 2 || under1Year >= 4);
        const hopper = !extremeHopper && !severeHopper && !stable && (under1Year >= 3 || under2Years >= 5);
        let hopperDetails = '';
        if (extremeHopper) hopperDetails = `${under6Months} jobs < 6mo`;
        else if (severeHopper) hopperDetails = `${under6Months} < 6mo, ${under1Year} < 1yr`;
        else if (hopper) hopperDetails = `${under1Year} < 1yr, ${under2Years} < 2yr`;
        return { earliest, stable, longTenure, hopper, severeHopper, extremeHopper, count: jobs.length, allJobs: jobs, hopperDetails, longTenureDetails };
    }

    function extractHSGradYear(text) {
        const eduSectionMatch = text.match(/(?:education(?:\s+and\s+training)?|academic\s+background)[\s\S]{0,800}?(?=(?:experience|work\s+history|employment|professional|skills|certifications?|summary|objective|$))/i);
        const eduText = eduSectionMatch ? eduSectionMatch[0] : '';
        const searchTexts = eduText ? [eduText, text] : [text];
        for (const searchText of searchTexts) {
            const patterns = [
                /(?:high\s+school|hs|secondary\s+school)[^0-9]{0,100}?(\d{4})/gi,
                /(?:high\s+school|hs|diploma)[^0-9]{0,50}?\d{1,2}\/(\d{4})/gi,
                /ged[^0-9]{0,50}?(\d{4})/gi,
            ];
            for (const p of patterns) {
                p.lastIndex = 0;
                let m;
                while ((m = p.exec(searchText)) !== null) {
                    const y = parseInt(m[1]);
                    if (y >= 1980 && y <= 2030) return y;
                }
            }
            if (searchText === eduText && eduText.length > 0) {
                const years = (eduText.match(/\b(19\d{2}|20\d{2})\b/g) || []).map(Number).filter(y => y >= 1980 && y <= 2030).sort((a, b) => b - a);
                if (years.length > 0) return years[0];
                break;
            }
        }
        return 0;
    }

    function assessQuality(text, isStructuredApi = false) {
        let q = 0;
        const len = text.length;
        const sections = (text.match(/\b(?:experience|work\s+experience|work\s+history|employment|education|skills|summary|career\s+objective|objective|certifications?|licenses?|achievements?)\b/gi) || []).length;
        const monthYear = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+\\d{4}';
        const dateRanges = (text.match(new RegExp(`\\b(?:${monthYear}|\\d{1,2}\\/\\d{4}|\\d{4})\\s*(?:[-–—~]|\\s+to\\s+)\\s*(?:present|current|currently|${monthYear}|\\d{1,2}\\/\\d{4}|\\d{4})\\b`, 'gi')) || []).length;
        const actionVerbs = (text.match(/\b(managed|developed|created|led|coordinated|implemented|organized|improved|achieved|delivered|maintained|operated|assisted|trained|resolved|processed|handled|performed)\b/gi) || []).length;

        if (len >= 700 && sections >= 3 && dateRanges >= 2) return 'average';
        if (len >= 1000 && sections >= 4) return 'average';
        if (sections >= 5 && dateRanges >= 1) return 'average';
        if (isStructuredApi && len >= 500 && (sections >= 2 || dateRanges >= 2)) return 'average';

        if (sections >= 3) q += 2; else if (sections < 2) q -= 2;
        if (dateRanges >= 2) q += 1; else if (dateRanges === 0) q -= 1;
        if (actionVerbs >= 4) q += 1;
        if (isStructuredApi) {
            if (len >= 500) q += 1;
            if (dateRanges >= 3) q += 1;
        } else {
            const bullets = (text.match(/[•\-*]\s+/g) || []).length;
            if (bullets >= 5) q += 1;
            if (len >= 1500) q += 2; else if (len < 400) q -= 2;
        }
        return q >= 5 ? 'good' : q >= 1 ? 'average' : 'basic';
    }

    function assessVisualPolish() {
        const root = $('[data-testid="pdf-resume-view"]') ||
                     $('[data-testid="ResumePanel_loaded"]') ||
                     $('[data-testid="ProfileResumePanel"]') ||
                     $('#candidateProfileContainer');
        if (!root) return { tier: 'none', points: 0, score: 0 };

        const rawText = root.innerText || root.textContent || '';
        const compactText = textOf(root);
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        const sectionHeaderRegex = /^(?:professional\s+summary|summary|profile|career\s+objective|objective|experience|work\s+experience|employment|education|skills|certifications?|licenses?|achievements?)$/i;
        const sectionHeaders = lines.filter(l => sectionHeaderRegex.test(l)).length;
        const bulletLines = lines.filter(l => /^[•·\-*]\s*/.test(l)).length;
        const dateLines = lines.filter(l =>
            /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}\s*[-–—]\s*(?:present|current|\d{4})\b/i.test(l)
        ).length;
        const shortLabelLines = lines.filter(l =>
            l.length <= 35 &&
            /^[A-Z][A-Za-z /&'.-]+$/.test(l) &&
            !/\d/.test(l) &&
            !sectionHeaderRegex.test(l)
        ).length;
        const contactSignals = [
            /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(compactText),
            /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(compactText),
            /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(compactText),
        ].filter(Boolean).length;
        const actionWords = (compactText.match(/\b(?:managed|trained|supervised|implemented|monitored|tracked|reported|operated|maintained|processed|coordinated|improved|organized|handled|delivered|assisted|performed|created|led)\b/gi) || []).length;
        const avgLineLength = lines.reduce((sum, l) => sum + l.length, 0) / Math.max(1, lines.length);
        const canvas = $('canvas', root) || $('canvas');
        const hasLargeCanvas = !!canvas && canvas.width >= 500 && canvas.height >= 700;
        const hasTextLayer = compactText.length >= 500;

        let score = 0;
        if (lines.length >= 25) score += 2;
        if (sectionHeaders >= 3) score += 3;
        if (bulletLines >= 6) score += 2;
        if (shortLabelLines >= 4) score += 1;
        if (dateLines >= 2) score += 1;
        if (contactSignals >= 2) score += 1;
        if (actionWords >= 5) score += 1;
        if (hasLargeCanvas && (hasTextLayer || compactText.length >= 300)) score += 1;
        if (avgLineLength > 120) score -= 1;

        const tier = score >= 8 ? 'strong' : score >= 5 ? 'polished' : 'none';
        return {
            tier,
            points: tier === 'strong' ? CONFIG.scores.strongResumeLayout : tier === 'polished' ? CONFIG.scores.polishedResumeLayout : 0,
            score,
            metrics: { lineCount: lines.length, sectionHeaders, bulletLines, shortLabelLines, dateLines, contactSignals, actionWords, avgLineLength: Math.round(avgLineLength), hasLargeCanvas, hasTextLayer },
        };
    }

    class Screener {
        constructor() {
            if (typeof DSP_UI === 'undefined') {
                console.error('[ONTH] DSP_UI is not defined. The @require script failed to load.');
                return;
            }
            this.extractor = null;
            this.lastResult = null;
            this.busy = false;
            this.autoScreenRunning = false;
            this.diag = new DiagnosticLogger();
            this._boundKeyHandler = this._onKeyDown.bind(this);
            this.buildPanel();
            this.bindEvents();
            this.run();
        }

        buildPanel() {
            const html = `
                <div class="dsp-stack dsp-font" id="rs-internal-wrap">
                    <div class="dsp-row" id="rs-drag-handle" style="justify-content: space-between; border-bottom: 1px solid var(--border-soft); padding-bottom: 8px;">
                        <div class="dsp-stack" style="gap: 2px;">
                            <div class="dsp-title" style="font-size: 18px; color: var(--accent);">Resume Screener</div>
                            <div class="dsp-muted" style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;">${CONFIG.ui.subtitle}</div>
                        </div>
                        <span class="dsp-badge" style="padding: 3px 8px;">v9.3</span>
                    </div>
                    <div class="dsp-stack" style="gap: 8px;">
                        <div class="dsp-row" style="padding: 6px 10px; background: rgba(0,0,0,0.2); border-radius: var(--radius-sm); border: 1px solid var(--border-soft);">
                            <div class="dsp-status-dot ready" id="rs-status-dot"></div>
                            <span class="dsp-font-mono" style="flex: 1; font-size: 11px; color: var(--text);" id="rs-status-text">Initializing…</span>
                        </div>
                        <div class="dsp-card dsp-stack" style="padding: 12px; gap: 8px;">
                            <div class="dsp-row" style="justify-content: space-between; align-items: center;">
                                <div class="dsp-stack" style="gap: 2px;">
                                    <span class="dsp-subtitle">Candidate Score</span>
                                    <span id="rs-score" style="font-family: var(--font-display); font-size: 48px; line-height: 1; color: var(--text-muted);">—</span>
                                    <span id="rs-tier" class="dsp-badge" style="width: fit-content; background: transparent; border-color: var(--border-main); color: var(--text-muted);">No Data</span>
                                </div>
                                <div class="dsp-stack" style="align-items: flex-end; gap: 2px;">
                                    <div class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--success)">●</span> Elite ≥ 100</div>
                                    <div class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--warning)">●</span> Review ≥ 70</div>
                                    <div class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--danger)">●</span> Maybe ≥ 40</div>
                                    <div class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--text-muted)">●</span> Reject &lt; 40</div>
                                </div>
                            </div>
                            <div style="height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; position: relative; margin-top: 4px;">
                                <div id="rs-bar-fill" style="position: absolute; top:0; left:0; bottom:0; background: var(--text-muted); width: 0%; transition: width 0.5s;"></div>
                            </div>
                        </div>
                        <div class="dsp-grid-2">
                            <div class="dsp-stack" style="gap: 4px;">
                                <div class="dsp-row" style="color: var(--success); border-bottom: 1px solid var(--border-soft); padding-bottom: 4px; font-weight: bold;">Positives</div>
                                <div id="rs-pos" style="max-height: 140px; overflow-y: auto; font-family: var(--font-mono); font-size: 10px; padding-right: 4px;" class="dsp-stack">
                                    <div class="dsp-muted" style="text-align:center; padding: 12px 0;">Analyzing…</div>
                                </div>
                            </div>
                            <div class="dsp-stack" style="gap: 4px;">
                                <div class="dsp-row" style="color: var(--danger); border-bottom: 1px solid var(--border-soft); padding-bottom: 4px; font-weight: bold;">Negatives</div>
                                <div id="rs-neg" style="max-height: 140px; overflow-y: auto; font-family: var(--font-mono); font-size: 10px; padding-right: 4px;" class="dsp-stack">
                                    <div class="dsp-muted" style="text-align:center; padding: 12px 0;">Analyzing…</div>
                                </div>
                            </div>
                        </div>
                        <div class="dsp-row" style="gap: 8px; margin-top: 4px;">
                            <button id="rs-yes" class="dsp-btn success" style="flex: 1;">✓ Advance <span class="dsp-muted" style="font-size:9px; margin-left:4px;">(Y)</span></button>
                            <button id="rs-no" class="dsp-btn danger" style="flex: 1;">✗ Reject <span class="dsp-muted" style="font-size:9px; margin-left:4px;">(N)</span></button>
                        </div>
                        <button id="rs-next" class="dsp-btn primary" style="width: 100%;">Next Candidate →</button>
                        <div class="dsp-row" style="gap: 8px;">
                            <button id="rs-refresh" class="dsp-btn" style="flex: 1;">↻ Re-analyze</button>
                            <button id="rs-auto-screen" class="dsp-btn" style="flex: 1;">⚡ Auto-Screen</button>
                        </div>
                        <div class="dsp-row" style="justify-content: center; gap: 16px; margin-top: 4px;">
                            <span class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--accent)">R</span> re-analyze</span>
                            <span class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--accent)">D</span> diagnostics</span>
                            <span class="dsp-subtitle" style="font-size: 9px;"><span style="color:var(--accent)">→</span> next</span>
                        </div>
                    </div>
                </div>
            `;
            this.panelNode = DSP_UI.createPanel({ html, width: "380px", top: "18px", right: "18px", bottom: "auto", zIndex: "2147483647", draggable: true, handle: "#rs-drag-handle" });
            this.panelNode.id = "rs-main-panel";
        }

        _onKeyDown(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            if (this.busy) return;
            if (e.key === 'y' || e.key === 'Y') this.clickYes();
            else if (e.key === 'n' || e.key === 'N') this.clickNo();
            else if (e.key === 'ArrowRight') this.nextCandidate();
            else if (e.key === 'r' || e.key === 'R') this.reanalyze();
            else if (e.key === 'd' || e.key === 'D') this.dumpDiag();
        }

        bindEvents() {
            $('#rs-yes').addEventListener('click', () => this.clickYes());
            $('#rs-no').addEventListener('click', () => this.clickNo());
            $('#rs-next').addEventListener('click', () => this.nextCandidate());
            $('#rs-refresh').addEventListener('click', () => this.reanalyze());
            $('#rs-auto-screen').addEventListener('click', () => this.autoScreenRunning ? this.stopAutoScreen() : this.autoScreen());
            document.addEventListener('keydown', this._boundKeyHandler);
        }

        destroy() {
            document.removeEventListener('keydown', this._boundKeyHandler);
            this.panelNode?.remove();
        }

        setButtonsEnabled(enabled) {
            for (const id of ['#rs-yes', '#rs-no', '#rs-next', '#rs-refresh']) {
                const btn = $(id);
                if (btn) btn.disabled = !enabled;
            }
        }

        dumpDiag() { this.diag.dump(`DIAGNOSTICS — ${this.extractor?.candidateName || 'Unknown'}`); }

        async run(previousFingerprint = '') {
            if (this.busy) return null;
            this.busy = true;
            this.setButtonsEnabled(false);
            this.diag.clear();
            this.setStatus('Waiting for candidate data…', 'loading');

            const dataReady = await waitForNewCandidate(previousFingerprint);
            if (!dataReady) {
                this.setStatus('Timeout — no candidate data', 'err');
                this.diag.dump('TIMEOUT');
                this.busy = false;
                this.setButtonsEnabled(true);
                return null;
            }

            const extractionReady = await waitForExtractionContent();
            this.diag.log('PIPELINE', `Extraction readiness: ${extractionReady.reason} DOM ${extractionReady.domLen}, API ${extractionReady.apiLen}`);
            this.setStatus('Extracting…', 'loading');
            this.extractor = new Extractor(this.diag);
            await this.extractor.extract();

            if (this.extractor.charCount < 100) {
                const msg = this.extractor.imageOnlyPdf
                    ? `Image-only PDF — manual review (${this.extractor.charCount} chars)`
                    : `Insufficient data: ${this.extractor.charCount} chars`;
                this.setStatus(msg, 'err');
                this.diag.dump('INSUFFICIENT DATA');
                this.busy = false;
                this.setButtonsEnabled(true);
                return null;
            }

            this.setStatus('Analyzing…', 'loading');
            this.lastResult = analyzeText(this.extractor.text, this.extractor, this.diag);
            if (this.isRepeatApplicant()) {
                this.lastResult.score -= 999;
                this.lastResult.neg['Repeat Applicant'] = -999;
                this.diag.log('SCORE', 'Repeat applicant: -999');
            }

            this.setStatus(`${this.extractor.method} · ${this.extractor.charCount.toLocaleString()} chars`, 'ok');
            this.render(this.lastResult);
            this.diag.dump(`DONE — ${this.extractor.candidateName || 'Unknown'} — Score: ${this.lastResult.score}`);
            this.busy = false;
            this.setButtonsEnabled(true);
            return this.lastResult;
        }

        async reanalyze() {
            if (this.busy) return;
            this.busy = true;
            this.setButtonsEnabled(false);
            this.diag.clear();
            this.setStatus('Re-analyzing…', 'loading');
            const extractionReady = await waitForExtractionContent();
            this.diag.log('PIPELINE', `Re-analysis readiness: ${extractionReady.reason} DOM ${extractionReady.domLen}, API ${extractionReady.apiLen}`);
            this.extractor = new Extractor(this.diag);
            await this.extractor.extract();
            this.setStatus(`${this.extractor.method} · ${this.extractor.charCount.toLocaleString()} chars`, this.extractor.charCount > 200 ? 'ok' : 'err');
            this.lastResult = analyzeText(this.extractor.text, this.extractor, this.diag);
            if (this.isRepeatApplicant()) {
                this.lastResult.score -= 999;
                this.lastResult.neg['Repeat Applicant'] = -999;
            }
            this.render(this.lastResult);
            this.diag.dump(`RE-ANALYSIS — ${this.extractor.candidateName || 'Unknown'} — Score: ${this.lastResult.score}`);
            this.busy = false;
            this.setButtonsEnabled(true);
        }

        setStatus(msg, state) {
            const dot = $('#rs-status-dot');
            const txt = $('#rs-status-text');
            if (!dot || !txt) return;
            txt.textContent = msg;
            dot.className = 'dsp-status-dot';
            if (state === 'loading') dot.classList.add('running');
            else if (state === 'ok') dot.classList.add('ready');
            else if (state === 'err') dot.classList.add('error');
        }

        render(r) {
            const T = CONFIG.thresholds;
            const tier = r.score >= T.elite ? 'elite' : r.score >= T.review ? 'review' : r.score >= T.maybe ? 'maybe' : 'reject';
            const tierLabel = { elite: '⬆ Elite', review: '● Review', maybe: '▲ Maybe', reject: '✗ Reject' };
            const tierColor = tier === 'elite' ? 'var(--success)' : tier === 'review' ? 'var(--warning)' : tier === 'maybe' ? 'var(--danger)' : 'var(--text-muted)';
            const tierBg = tier === 'elite' ? 'var(--success-bg)' : tier === 'review' ? 'var(--warning-bg)' : tier === 'maybe' ? 'var(--danger-bg)' : 'transparent';

            const scoreEl = $('#rs-score');
            if (scoreEl) { scoreEl.textContent = r.score; scoreEl.style.color = tierColor; }
            const tierEl = $('#rs-tier');
            if (tierEl) {
                tierEl.textContent = tierLabel[tier];
                tierEl.style.color = tierColor;
                tierEl.style.borderColor = tierColor;
                tierEl.style.background = tierBg;
            }
            this.panelNode.style.borderTop = `3px solid ${tierColor}`;
            const barFill = $('#rs-bar-fill');
            if (barFill) {
                const pct = Math.min(100, Math.max(0, Math.round((r.score / 200) * 100)));
                barFill.style.width = pct + '%';
                barFill.style.background = tierColor;
                barFill.style.boxShadow = `0 0 8px ${tierColor}`;
            }

            const formatItem = (label, pts, isPos) => `
                <div class="dsp-row" style="justify-content: space-between; background: var(--surface); padding: 4px 6px; border: 1px solid var(--border-soft); border-radius: 4px; margin-bottom: 4px;">
                    <span style="color: var(--text-main); font-size: 10px; line-height: 1.2;">${this.escapeHtml(label)}</span>
                    <span class="dsp-chip ${isPos ? 'good' : 'bad'}" style="padding: 2px 4px; font-size: 9px; border:none; margin-left:6px;">${isPos ? '+' : ''}${pts}</span>
                </div>
            `;
            const posEl = $('#rs-pos');
            const negEl = $('#rs-neg');
            const posKeys = Object.keys(r.pos);
            const negKeys = Object.keys(r.neg);
            posEl.innerHTML = posKeys.length ? posKeys.map(k => formatItem(k, r.pos[k], true)).join('') : '<div class="dsp-muted" style="text-align:center; padding: 12px 0;">None found</div>';
            negEl.innerHTML = negKeys.length ? negKeys.map(k => formatItem(k, r.neg[k], false)).join('') : '<div class="dsp-muted" style="text-align:center; padding: 12px 0;">None found</div>';
        }

        escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        resetUI() {
            const scoreEl = $('#rs-score');
            if (scoreEl) { scoreEl.textContent = '—'; scoreEl.style.color = 'var(--text-muted)'; }
            const tierEl = $('#rs-tier');
            if (tierEl) {
                tierEl.textContent = 'No Data';
                tierEl.style.color = 'var(--text-muted)';
                tierEl.style.borderColor = 'var(--border-main)';
                tierEl.style.background = 'transparent';
            }
            this.panelNode.style.borderTop = '1px solid var(--border-main)';
            const barFill = $('#rs-bar-fill');
            if (barFill) { barFill.style.width = '0%'; barFill.style.background = 'var(--text-muted)'; barFill.style.boxShadow = 'none'; }
            $('#rs-pos').innerHTML = '<div class="dsp-muted" style="text-align:center; padding: 12px 0;">Analyzing…</div>';
            $('#rs-neg').innerHTML = '<div class="dsp-muted" style="text-align:center; padding: 12px 0;">Analyzing…</div>';
        }

        async clickYes() {
            if (this.busy) return;
            const btn = $('[data-testid="ApplicantSentiment-yes"]') || findIndeedButton('M9.55 14.947');
            if (btn) { btn.click(); await sleep(CONFIG.timing.clickActionDelay); await this.nextCandidate(); }
        }

        async clickNo() {
            if (this.busy) return;
            const btn = $('[data-testid="ApplicantSentiment-no"]') || findIndeedButton('M12 13.59');
            if (btn) { btn.click(); await sleep(CONFIG.timing.clickActionDelay); await this.nextCandidate(); }
        }

        async nextCandidate() {
            if (this.busy) return;
            const currentFingerprint = getCandidateFingerprint();
            this.resetUI();
            this.setStatus('Loading next candidate…', 'loading');
            const btn = findIndeedButton('M17.864 13.138') || $$('button').find(b => /next|→/i.test(b.textContent));
            if (!btn) { this.setStatus('No next button found', 'err'); return; }
            btn.click();
            await sleep(CONFIG.timing.unmountGrace);
            await this.run(currentFingerprint);
        }

        isRepeatApplicant() {
            if (this.extractor?.apiCandidate?.submissionCount !== null && this.extractor.apiCandidate.submissionCount > 1) return true;
            if (this.extractor?.fiber?.found && this.extractor.fiber.getSubmissionCount() > 1) return true;
            for (const btn of $$('button')) {
                const text = btn.textContent || btn.innerText || '';
                if (/this candidate has applied to \d+ other jobs? on this account/i.test(text)) return true;
            }
            return false;
        }

        async autoScreen() {
            this.autoScreenRunning = true;
            const btn = $('#rs-auto-screen');
            if (!btn) return;
            btn.textContent = '⏹ Stop';
            btn.className = 'dsp-btn danger';
            let rejected = 0, total = 0, lastFingerprint = '', stuckCount = 0;
            while (this.autoScreenRunning) {
                const currentFp = getCandidateFingerprint();
                if (currentFp && currentFp === lastFingerprint) {
                    stuckCount++;
                    if (stuckCount >= 3) { this.setStatus('Stuck — stopped', 'err'); break; }
                } else stuckCount = 0;
                lastFingerprint = currentFp;
                total++;
                const result = await this.run();
                if (!this.autoScreenRunning || !result) break;
                if (this.isRepeatApplicant()) {
                    const noBtn = $('[data-testid="ApplicantSentiment-no"]') || findIndeedButton('M12.0001 13.5909') || findIndeedButton('M12 13.59');
                    if (noBtn) noBtn.click();
                    rejected++;
                    btn.textContent = `⏹ ${rejected}/${total}`;
                    await sleep(CONFIG.timing.clickActionDelay);
                } else {
                    btn.textContent = `⏹ ${rejected}/${total}`;
                    break;
                }
                const fpBeforeNav = getCandidateFingerprint();
                const nextBtn = findIndeedButton('M17.864 13.138') || $$('button').find(b => /next|→/i.test(b.textContent));
                if (!nextBtn) break;
                this.resetUI();
                this.setStatus('Loading next…', 'loading');
                nextBtn.click();
                await sleep(CONFIG.timing.unmountGrace);
                if (!(await waitForNewCandidate(fpBeforeNav))) break;
            }
            this.stopAutoScreen();
        }

        stopAutoScreen() {
            this.autoScreenRunning = false;
            const btn = $('#rs-auto-screen');
            if (!btn) return;
            btn.textContent = '⚡ Auto-Screen';
            btn.className = 'dsp-btn';
        }
    }

    function init() {
        if (PAGE._screenerInstance93) return;
        API_CACHE.install();
        let created = false;
        const container = $('#candidateProfileContainer');
        if (container && textOf(container).length > 100) {
            created = true;
            PAGE._screenerInstance93 = new Screener();
            return;
        }
        const observer = new MutationObserver(() => {
            if (created) return;
            const c = $('#candidateProfileContainer');
            if (c && textOf(c).length > 100) {
                created = true;
                observer.disconnect();
                PAGE._screenerInstance93 = new Screener();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            if (!created && !PAGE._screenerInstance93) {
                created = true;
                PAGE._screenerInstance93 = new Screener();
            }
        }, 4000);
    }

    PAGE.__resumeScreenerApiCache = API_CACHE;
    PAGE.__resumeScreenerMergeResumeSources = mergeResumeSources;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
