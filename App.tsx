
import React, { useState, useEffect } from 'react';
import { Conversation, EvaluationResult, ViewState, Message, Role, Comment, Criteria, ConversationCategory, Folder } from './types';
import { evaluateConversation, generateSampleConversation, performFactCheck, classifyConversation, getLLMConfig } from './services/geminiService';
import { loadConversationsFromStorage, saveConversationsToStorage, safeSetLocalStorage } from './services/storage';
import { ScoreRadar } from './components/ScoreRadar';
import { ChatInterface } from './components/ChatInterface';
import { CriteriaSettings } from './components/CriteriaSettings';
import { Button } from './components/Button';

// Mock storage keys
const STORAGE_KEY = 'evalai_conversations';
const CRITERIA_STORAGE_KEY = 'evalai_criteria';
const FOLDERS_STORAGE_KEY = 'evalai_folders';
const VIEW_MODE_STORAGE_KEY = 'evalai_view_mode';

const DEFAULT_CRITERIA: Criteria[] = [
  { id: 'c1', name: 'Relevance', description: "How well the response addresses the user’s question and context." },
  { id: 'c2', name: 'Trustworthiness', description: "How responsible and transparent the advice is about uncertainty, limits or sources." },
  { id: 'c3', name: 'Accuracy', description: "Whether verifiable facts, steps and figures are correct." },
  { id: 'c4', name: 'Understandable Language', description: "How concise, well-structured and easy to understand the wording is." },
  { id: 'c5', name: 'Completeness / Match', description: "Whether it covers the essential needs and gives a concrete next step (e.g., contact/location/time/materials, ≥2 elements)." },
  { id: 'c6', name: 'Helpfulness / Task Progress', description: "Whether the AI meaningfully moved the user closer to their goal. If the AI ONLY asked for clarification without offering any partial answer, suggestion, or alternative value, score 2–3 at most. Repeated clarification loops with no progress should score 1–2." }
];

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('dashboard');
  const [categoryFilter, setCategoryFilter] = useState<ConversationCategory | 'All'>('All');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [criteria, setCriteria] = useState<Criteria[]>(DEFAULT_CRITERIA);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Folders & View Mode States
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL'); // 'ALL' | 'UNASSIGNED' | folderId
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('indigo');
  const [targetUploadFolderId, setTargetUploadFolderId] = useState<string>('');

  // Evaluation Options
  const [enableFactCheck, setEnableFactCheck] = useState(false);
  const [showContextInputs, setShowContextInputs] = useState(false);
  const [activeProvider, setActiveProvider] = useState<'gemini' | 'openai' | 'anthropic'>('gemini');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkEvalProgress, setBulkEvalProgress] = useState<{
    total: number;
    current: number;
    running: boolean;
    errorCount: number;
  } | null>(null);
  const cancelBulkRef = React.useRef(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [hasProviderKey, setHasProviderKey] = useState({
    gemini: false,
    openai: false,
    anthropic: false
  });
  const [appTemperature, setAppTemperature] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = localStorage.getItem('evalai_temperature');
    return stored !== null ? parseFloat(stored) : 0;
  });

  const handleTemperatureChange = (val: number) => {
    setAppTemperature(val);
    safeSetLocalStorage('evalai_temperature', String(val));
  };

  const checkKeys = () => {
    const fallbackGeminiKey = sessionStorage.getItem('evalai_api_key') || '';
    const geminiKey = sessionStorage.getItem('evalai_gemini_api_key') || fallbackGeminiKey;
    const openaiKey = sessionStorage.getItem('evalai_openai_api_key') || '';
    const anthropicKey = sessionStorage.getItem('evalai_anthropic_api_key') || '';
    
    setHasProviderKey({
      gemini: !!geminiKey,
      openai: !!openaiKey,
      anthropic: !!anthropicKey
    });
  };

  // Switch dynamic provider helper
  const handleProviderChange = (provider: 'gemini' | 'openai' | 'anthropic') => {
    setActiveProvider(provider);
    safeSetLocalStorage('evalai_provider', provider);
    // Backward fallback safety for active key using sessionStorage
    if (provider === 'gemini') {
      const geminiKey = sessionStorage.getItem('evalai_gemini_api_key') || sessionStorage.getItem('evalai_api_key') || '';
      if (geminiKey) {
        sessionStorage.setItem('evalai_api_key', geminiKey);
      }
    }
  };

  // Load data from persistent storage on mount
  useEffect(() => {
    loadConversationsFromStorage().then(stored => {
      if (stored && Array.isArray(stored)) {
        setConversations(stored);
      }
    }).catch(err => {
      console.error("Failed to load conversations from storage", err);
    });

    const storedCriteria = localStorage.getItem(CRITERIA_STORAGE_KEY);
    if (storedCriteria) {
      try {
        const parsed = JSON.parse(storedCriteria);
        // If it contains old metrics or lacks our new "Helpfulness / Task Progress" metric or its description, migrate automatically
        const isOldDefault = Array.isArray(parsed) && (
          parsed.some(c => c.name === 'Helpfulness' || c.name === 'Coherence') ||
          !parsed.some(c => c.id === 'c6' || c.name.includes('Helpfulness / Task Progress')) ||
          parsed.some(c => c.id === 'c6' && !c.description.includes('score 2–3 at most'))
        );
        if (isOldDefault) {
          setCriteria(DEFAULT_CRITERIA);
          safeSetLocalStorage(CRITERIA_STORAGE_KEY, JSON.stringify(DEFAULT_CRITERIA));
        } else {
          setCriteria(parsed);
        }
      } catch (e) {
        console.error("Failed to parse stored criteria", e);
      }
    } else {
      safeSetLocalStorage(CRITERIA_STORAGE_KEY, JSON.stringify(DEFAULT_CRITERIA));
    }

    const storedProvider = localStorage.getItem('evalai_provider') as 'gemini' | 'openai' | 'anthropic';
    if (storedProvider) {
      setActiveProvider(storedProvider);
    }

    const storedFolders = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (storedFolders) {
      try {
        setFolders(JSON.parse(storedFolders));
      } catch (e) {
        console.error("Failed to parse stored folders", e);
      }
    }

    const storedViewMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY) as 'grid' | 'list';
    if (storedViewMode) {
      setViewMode(storedViewMode);
    }

    checkKeys();
  }, []);

  // Keep API key checks fresh when view shifts back from settings
  useEffect(() => {
    if (viewState === 'editor' || viewState === 'dashboard') {
      checkKeys();
      const storedProvider = localStorage.getItem('evalai_provider') as 'gemini' | 'openai' | 'anthropic';
      if (storedProvider) {
        setActiveProvider(storedProvider);
      }
      const storedTemp = localStorage.getItem('evalai_temperature');
      if (storedTemp !== null) {
        setAppTemperature(parseFloat(storedTemp));
      }
    }
  }, [viewState]);

  // Save conversations to IndexedDB on change (no quota limits)
  useEffect(() => {
    saveConversationsToStorage(conversations).catch(err => {
      console.warn("Error auto-saving conversations to storage:", err);
    });
  }, [conversations]);

  useEffect(() => {
    safeSetLocalStorage(CRITERIA_STORAGE_KEY, JSON.stringify(criteria));
  }, [criteria]);

  useEffect(() => {
    safeSetLocalStorage(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    safeSetLocalStorage(VIEW_MODE_STORAGE_KEY, mode);
  };

  const handleCreateFolder = (name: string, color = 'indigo') => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name: trimmed,
      color,
      createdAt: Date.now()
    };
    setFolders(prev => [...prev, newFolder]);
    setSelectedFolderId(newFolder.id);
    setNewFolderName('');
    setShowNewFolderModal(false);
    return newFolder.id;
  };

  const handleDeleteFolder = (folderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const folder = folders.find(f => f.id === folderId);
    const folderName = folder ? folder.name : 'this folder';
    setConfirmModal({
      isOpen: true,
      title: 'Delete Folder',
      message: `Are you sure you want to delete folder "${folderName}"? Conversations inside will be unassigned.`,
      confirmLabel: 'Delete Folder',
      onConfirm: () => {
        setFolders(prev => prev.filter(f => f.id !== folderId));
        setConversations(prev => prev.map(c => c.folderId === folderId ? { ...c, folderId: undefined } : c));
        if (selectedFolderId === folderId) {
          setSelectedFolderId('ALL');
        }
        if (targetUploadFolderId === folderId) {
          setTargetUploadFolderId('');
        }
        setConfirmModal(null);
      }
    });
  };

  const handleMoveSelectedToFolder = (targetFolderId: string) => {
    if (selectedIds.length === 0) return;
    const fId = (targetFolderId === '' || targetFolderId === 'UNASSIGNED') ? undefined : targetFolderId;
    setConversations(prev => prev.map(c => selectedIds.includes(c.id) ? { ...c, folderId: fId } : c));
  };

  const handleMoveSingleToFolder = (convId: string, targetFolderId: string, e?: React.ChangeEvent<HTMLSelectElement>) => {
    if (e) e.stopPropagation();
    const fId = (targetFolderId === '' || targetFolderId === 'UNASSIGNED') ? undefined : targetFolderId;
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, folderId: fId } : c));
    if (currentConversation && currentConversation.id === convId) {
      setCurrentConversation(prev => prev ? { ...prev, folderId: fId } : null);
    }
  };

  const deleteConversation = (convId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const conv = conversations.find(c => c.id === convId);
    const title = conv ? `"${conv.title}"` : 'this conversation';
    setConfirmModal({
      isOpen: true,
      title: 'Delete Conversation',
      message: `Are you sure you want to delete ${title}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        setConversations(prev => prev.filter(c => c.id !== convId));
        setSelectedIds(prev => prev.filter(id => id !== convId));
        if (currentConversation && currentConversation.id === convId) {
          setCurrentConversation(null);
          setViewState('dashboard');
        }
        setConfirmModal(null);
      }
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    setConfirmModal({
      isOpen: true,
      title: 'Delete Selected Conversations',
      message: `Are you sure you want to delete ${count} selected conversation(s)? This action cannot be undone.`,
      confirmLabel: `Delete ${count} Conversation${count > 1 ? 's' : ''}`,
      onConfirm: () => {
        setConversations(prev => prev.filter(c => !selectedIds.includes(c.id)));
        if (currentConversation && selectedIds.includes(currentConversation.id)) {
          setCurrentConversation(null);
          setViewState('dashboard');
        }
        setSelectedIds([]);
        setConfirmModal(null);
      }
    });
  };

  const getFolderColorClasses = (color?: string) => {
    switch (color) {
      case 'emerald':
        return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', active: 'bg-emerald-600 text-white' };
      case 'amber':
        return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', active: 'bg-amber-600 text-white' };
      case 'rose':
        return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500', active: 'bg-rose-600 text-white' };
      case 'sky':
        return { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500', active: 'bg-sky-600 text-white' };
      case 'purple':
        return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500', active: 'bg-purple-600 text-white' };
      case 'slate':
        return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', dot: 'bg-slate-500', active: 'bg-slate-700 text-white' };
      case 'indigo':
      default:
        return { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500', active: 'bg-indigo-650 text-white' };
    }
  };

  const handleCreateNew = async () => {
    setIsEvaluating(true);
    try {
      const activeFolder = targetUploadFolderId || (selectedFolderId !== 'ALL' && selectedFolderId !== 'UNASSIGNED' ? selectedFolderId : undefined);
      const newConv = await generateSampleConversation();
      const category = await classifyConversation(newConv);
      const newConvWithCategory = { ...newConv, category, folderId: activeFolder };
      setConversations(prev => [newConvWithCategory, ...prev]);
      setCurrentConversation(newConvWithCategory);
      setViewState('editor');
    } catch (e: any) {
      setError(e?.message || "Failed to generate sample conversation.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleSelectConversation = async (conv: Conversation) => {
    setCurrentConversation(conv);
    setViewState('editor');
    
    // Automatically classify on-the-fly in the background if it was uncategorized or missing category and we have key access
    if (!conv.category || conv.category === 'Uncategorized') {
      try {
        const config = getLLMConfig();
        const hasKey = config.provider === 'gemini' ? !!config.geminiKey :
                       config.provider === 'openai' ? !!config.openaiKey :
                       config.provider === 'anthropic' ? !!config.anthropicKey : false;
        
        if (hasKey) {
          const category = await classifyConversation(conv);
          setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, category } : c));
          setCurrentConversation(prev => prev && prev.id === conv.id ? { ...prev, category } : prev);
        }
      } catch (e) {
        console.warn("Auto-classification backfill failed", e);
      }
    }
  };

  const downloadFile = (filename: string, content: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const generateTextReport = (conv: Conversation): string => {
    const border = "================================================================================";
    const divider = "--------------------------------------------------------------------------------";
    
    let report = "";
    report += `${border}\n`;
    report += `MATCHEVAL SYSTEM REPORT - EVALUATION RESULTS\n`;
    report += `${border}\n`;
    report += `Conversation Title: ${conv.title}\n`;
    report += `Generated At:       ${conv.evaluation ? new Date(conv.evaluation.timestamp).toLocaleString() : 'N/A'}\n`;
    report += `Turn Count:         ${conv.messages.length} turns\n`;
    if (conv.evaluation) {
      report += `Overall Score:      ${conv.evaluation.overallScore}/10\n`;
    } else {
      report += `Overall Score:      DRAFT (No Evaluation Run Yet)\n`;
    }
    report += `${divider}\n`;
    
    if (conv.evaluation) {
      report += `\nEXECUTIVE SUMMARY:\n`;
      report += `${conv.evaluation.summary}\n\n`;
      report += `${divider}\n`;
      
      if (conv.evaluation.factCheckReport) {
        report += `\nFACT CHECK ANALYSIS:\n`;
        report += `${conv.evaluation.factCheckReport}\n`;
        if (conv.evaluation.factCheckSources && conv.evaluation.factCheckSources.length > 0) {
          report += `Sources:\n`;
          conv.evaluation.factCheckSources.forEach(src => {
            report += ` - ${src.title} (${src.uri})\n`;
          });
        }
        report += `\n${divider}\n`;
      }
      
      report += `\nCRITERIA BREAKDOWN:\n`;
      conv.evaluation.metrics.forEach(metric => {
        report += `\n*  ${metric.name}: ${metric.score}/10\n`;
        report += `   Reasoning: ${metric.reasoning}\n`;
      });
      report += `\n${divider}\n`;
      
      if (conv.evaluation.suggestedImprovements) {
        report += `\nSUGGESTED IMPROVEMENTS:\n`;
        const raw = conv.evaluation.suggestedImprovements;
        let lines: string[] = [];
        if (Array.isArray(raw)) {
          lines = raw.map(item => String(item));
        } else if (typeof raw === 'string') {
          lines = raw.split('\n');
        } else if (raw) {
          lines = [String(raw)];
        }
        lines.filter(l => l.trim()).forEach(line => {
          const clean = line.replace(/^[\*\-•]\s*/, '').trim();
          report += ` - ${clean}\n`;
        });
        report += `\n${divider}\n`;
      }
    } else {
      report += `\nNo evaluation report available for this conversation.\n`;
    }
    
    report += `\nTRANSCRIPT:\n`;
    conv.messages.forEach((msg, idx) => {
      report += `\n[Turn ${idx + 1}] ${msg.role.toUpperCase()}:\n`;
      report += `${msg.content}\n`;
      if (msg.comments && msg.comments.length > 0) {
        report += `  Comments:\n`;
        msg.comments.forEach(c => {
          report += `    - [${new Date(c.timestamp).toLocaleTimeString()}] ${c.text}\n`;
        });
      }
    });
    
    report += `\n${border}\n`;
    return report;
  };

  const generateMarkdownReport = (conv: Conversation): string => {
    let md = `# MatchEval Evaluation Report: ${conv.title}\n\n`;
    
    md += `- **Generated At:** ${conv.evaluation ? new Date(conv.evaluation.timestamp).toLocaleString() : 'N/A'}\n`;
    md += `- **Turns:** ${conv.messages.length} messages\n`;
    if (conv.evaluation) {
      md += `- **Overall Score:** \`${conv.evaluation.overallScore}/10\`\n\n`;
      
      md += `## Executive Summary\n\n${conv.evaluation.summary}\n\n`;
      
      if (conv.evaluation.factCheckReport) {
        md += `## Fact Check Analysis\n\n${conv.evaluation.factCheckReport}\n\n`;
        if (conv.evaluation.factCheckSources && conv.evaluation.factCheckSources.length > 0) {
          md += `### Fact Check Sources\n\n`;
          conv.evaluation.factCheckSources.forEach(src => {
            md += `- [${src.title}](${src.uri})\n`;
          });
          md += `\n`;
        }
      }
      
      md += `## Criteria Breakdown\n\n`;
      conv.evaluation.metrics.forEach(metric => {
        md += `### ${metric.name} (${metric.score}/10)\n\n`;
        md += `${metric.reasoning}\n\n`;
      });
      
      if (conv.evaluation.suggestedImprovements) {
        md += `## Suggested Improvements\n\n`;
        const raw = conv.evaluation.suggestedImprovements;
        let lines: string[] = [];
        if (Array.isArray(raw)) {
          lines = raw.map(item => String(item));
        } else if (typeof raw === 'string') {
          lines = raw.split('\n');
        } else if (raw) {
          lines = [String(raw)];
        }
        lines.filter(l => l.trim()).forEach(line => {
          const clean = line.replace(/^[\*\-•]\s*/, '').trim();
          md += `- ${clean}\n`;
        });
        md += `\n`;
      }
    } else {
      md += `*No evaluation available.*\n\n`;
    }
    
    md += `## Conversation Transcript\n\n`;
    conv.messages.forEach((msg) => {
      md += `### **${msg.role === 'user' ? 'User' : 'Assistant'}**\n\n`;
      md += `${msg.content}\n\n`;
      if (msg.comments && msg.comments.length > 0) {
        md += `#### Comments\n\n`;
        msg.comments.forEach(c => {
          md += `- ${c.text} *(${new Date(c.timestamp).toLocaleTimeString()})*\n`;
        });
        md += `\n`;
      }
    });
    
    return md;
  };

  const handleExportConversation = (format: 'json' | 'txt' | 'md') => {
    if (!currentConversation) return;
    const safeTitle = currentConversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'conversation';
    
    if (format === 'json') {
      const jsonString = JSON.stringify(currentConversation, null, 2);
      downloadFile(`${safeTitle}_evaluated.json`, jsonString, 'application/json');
    } else if (format === 'txt') {
      const txtContent = generateTextReport(currentConversation);
      downloadFile(`${safeTitle}_report.txt`, txtContent, 'text/plain');
    } else if (format === 'md') {
      const mdContent = generateMarkdownReport(currentConversation);
      downloadFile(`${safeTitle}_report.md`, mdContent, 'text/markdown');
    }
  };

  const handleBulkExport = (format: 'json' | 'txt' | 'md') => {
    const selectedConvs = conversations.filter(c => selectedIds.includes(c.id));
    if (selectedConvs.length === 0) return;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 10);
    
    if (format === 'json') {
      const jsonString = JSON.stringify(selectedConvs, null, 2);
      downloadFile(`matcheval_bulk_export_${timestamp}.json`, jsonString, 'application/json');
    } else if (format === 'txt') {
      const divider = "\n\n" + "=".repeat(100) + "\n\n" + "  NEXT MATCHEVAL REPORT IN BULK EXPORT\n" + "=".repeat(100) + "\n\n";
      const txtContent = selectedConvs.map(generateTextReport).join(divider);
      downloadFile(`matcheval_bulk_report_${timestamp}.txt`, txtContent, 'text/plain');
    } else if (format === 'md') {
      const divider = "\n\n---\n\n";
      const mdContent = "# MatchEval Bulk Reports Export\n\n" + selectedConvs.map(generateMarkdownReport).join(divider);
      downloadFile(`matcheval_bulk_report_${timestamp}.md`, mdContent, 'text/markdown');
    }
  };

  const handleBulkEvaluate = async (overrideIds?: string[]) => {
    const idsToEvaluate = overrideIds || [...selectedIds];
    if (idsToEvaluate.length === 0) return;

    const currentProvider = activeProvider;
    const hasKey = hasProviderKey[currentProvider];
    if (!hasKey) {
      setError(`Please set your API key for ${currentProvider.toUpperCase()} in Settings first.`);
      return;
    }

    setBulkEvalProgress({ total: idsToEvaluate.length, current: 0, running: true, errorCount: 0 });
    setIsEvaluating(true);
    setError(null);
    cancelBulkRef.current = false;

    let completedCount = 0;
    let failedCount = 0;

    for (const id of idsToEvaluate) {
      if (cancelBulkRef.current) break;

      const conv = conversations.find(c => c.id === id);
      if (!conv) {
        completedCount++;
        setBulkEvalProgress(prev => prev ? { ...prev, current: completedCount } : null);
        continue;
      }

      try {
        let factCheckData = undefined;
        if (enableFactCheck) {
          try {
            factCheckData = await performFactCheck(conv);
          } catch (fcErr) {
            console.warn("Fact check failed for conversation", id, fcErr);
          }
        }

        // Run evaluation
        const evaluation = await evaluateConversation(conv, criteria, factCheckData);

        // Also classify it
        let category = conv.category;
        try {
          category = await classifyConversation(conv);
        } catch (catErr) {
          console.warn("Classification failed for conversation", id, catErr);
        }

        const updatedConv: Conversation = { ...conv, evaluation, category };

        // Update list states
        setConversations(prev => prev.map(c => c.id === id ? updatedConv : c));
        
        // Update current viewing conversation if matched
        setCurrentConversation(curr => curr && curr.id === id ? updatedConv : curr);

      } catch (err: any) {
        console.error(`Failed to evaluate conversation ${id}:`, err);
        failedCount++;
      } finally {
        completedCount++;
        setBulkEvalProgress(prev => prev ? {
          ...prev,
          current: completedCount,
          errorCount: failedCount
        } : null);
      }
    }

    setIsEvaluating(false);
    // Keep the progress showing for a short moment so they can see completion, then clear
    setTimeout(() => {
      setBulkEvalProgress(null);
    }, 3000);
  };

  const handleAnalyzeAll = () => {
    const allIds = conversations.map(c => c.id);
    if (allIds.length === 0) return;
    setSelectedIds(allIds);
    handleBulkEvaluate(allIds);
  };

  const extractTextContent = (rawContent: any): string => {
    if (rawContent === null || rawContent === undefined) return '';
    if (typeof rawContent === 'string') return rawContent;
    if (typeof rawContent === 'number' || typeof rawContent === 'boolean') return String(rawContent);
    if (Array.isArray(rawContent)) {
      return rawContent
        .map(item => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            return item.text || item.content || item.value || item.message || item.summary || JSON.stringify(item);
          }
          return String(item);
        })
        .filter(Boolean)
        .join('\n');
    }
    if (typeof rawContent === 'object') {
      if (rawContent.text) return String(rawContent.text);
      if (rawContent.content) return extractTextContent(rawContent.content);
      if (rawContent.value) return String(rawContent.value);
      return JSON.stringify(rawContent);
    }
    return String(rawContent);
  };

  const parseTextIntoTurns = (text: string, seed: string): Message[] => {
    if (!text || typeof text !== 'string') return [];

    // 1. ChatML format: <|im_start|>system ... <|im_end|>
    if (text.includes('<|im_start|>')) {
      const parts = text.split(/<\|im_start\|>/i).filter(p => p.trim());
      const msgs: Message[] = [];
      parts.forEach((part, idx) => {
        const clean = part.replace(/<\|im_end\|>/gi, '').trim();
        const match = clean.match(/^(system|user|human|assistant|bot|model|agent)\s*\n?([\s\S]*)$/i);
        if (match) {
          const roleStr = match[1].toLowerCase();
          const content = match[2].trim();
          if (content) {
            if (roleStr === 'system') {
              msgs.push({ id: `msg-${seed}-${idx}`, role: Role.USER, content: `[System Instruction]\n${content}`, comments: [] });
            } else {
              const isModel = ['assistant', 'bot', 'ai', 'model', 'gpt', 'agent'].includes(roleStr);
              msgs.push({ id: `msg-${seed}-${idx}`, role: isModel ? Role.MODEL : Role.USER, content, comments: [] });
            }
          }
        }
      });
      if (msgs.length > 0) return msgs;
    }

    // 2. Llama [INST] format: [INST] user prompt [/INST] model response
    if (text.includes('[INST]')) {
      const instRegex = /\[INST\]([\s\S]*?)\[\/INST\]/gi;
      const msgs: Message[] = [];
      let lastIndex = 0;
      let match;
      let idx = 0;
      while ((match = instRegex.exec(text)) !== null) {
        const prefix = text.slice(lastIndex, match.index).trim();
        if (prefix && idx === 0) {
          const cleanSys = prefix.replace(/<<SYS>>|<\/SYS>|<s>|<\/s>/g, '').trim();
          if (cleanSys) {
            msgs.push({ id: `msg-${seed}-sys`, role: Role.USER, content: `[System Instruction]\n${cleanSys}`, comments: [] });
          }
        }
        const userContent = match[1].replace(/<<SYS>>|<\/SYS>|<s>|<\/s>/g, '').trim();
        if (userContent) {
          msgs.push({ id: `msg-${seed}-${idx++}`, role: Role.USER, content: userContent, comments: [] });
        }
        lastIndex = instRegex.lastIndex;
      }
      const tail = text.slice(lastIndex).replace(/\[\/?INST\]|<s>|<\/s>/g, '').trim();
      if (tail) {
        msgs.push({ id: `msg-${seed}-${idx++}`, role: Role.MODEL, content: tail, comments: [] });
      }
      if (msgs.length > 0) return msgs;
    }

    // 3. Role headers: Human: / Assistant: or User: / Model: or System:
    const rolePattern = /(?:^|\n)(System|User|Human|Customer|Client|Assistant|Model|Bot|AI|GPT|Response):\s*/gi;
    const matches = Array.from(text.matchAll(rolePattern));
    if (matches.length >= 2) {
      const msgs: Message[] = [];
      for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const roleName = current[1].toLowerCase();
        const content = text.slice(current.index! + current[0].length, nextIndex).trim();
        if (content) {
          if (roleName === 'system') {
            msgs.push({ id: `msg-${seed}-${i}`, role: Role.USER, content: `[System Instruction]\n${content}`, comments: [] });
          } else {
            const isModel = ['assistant', 'model', 'bot', 'ai', 'gpt', 'response'].includes(roleName);
            msgs.push({ id: `msg-${seed}-${i}`, role: isModel ? Role.MODEL : Role.USER, content, comments: [] });
          }
        }
      }
      if (msgs.length > 0) return msgs;
    }

    return [];
  };

  const convertJsonObjectToConversation = (json: any, idx: number, fileName: string): Conversation => {
    const seed = `${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`;
    const cleanFileName = fileName.replace(/\.(json|jsonl|txt|jsonlines)$/i, '');

    // Handle primitive string or stringified JSON
    if (typeof json === 'string') {
      try {
        const parsed = JSON.parse(json);
        if (typeof parsed === 'object' && parsed !== null) {
          return convertJsonObjectToConversation(parsed, idx, fileName);
        }
      } catch {
        const turns = parseTextIntoTurns(json, seed);
        if (turns.length > 0) {
          return {
            id: `conv-${seed}`,
            title: turns.find(t => t.role === Role.USER)?.content.replace(/^\[System Instruction\]\n?/, '').slice(0, 36) || `${cleanFileName} #${idx + 1}`,
            messages: turns,
            createdAt: Date.now()
          };
        }
        return {
          id: `conv-${seed}`,
          title: json.trim().slice(0, 36) || `${cleanFileName} #${idx + 1}`,
          messages: [{ id: `msg-${seed}-0`, role: Role.USER, content: json, comments: [] }],
          createdAt: Date.now()
        };
      }
    }

    if (!json || typeof json !== 'object') {
      return {
        id: `conv-${seed}`,
        title: `${cleanFileName} #${idx + 1}`,
        messages: [{ id: `msg-${seed}-0`, role: Role.USER, content: String(json || ''), comments: [] }],
        createdAt: Date.now()
      };
    }

    // Extract root level system prompt if any
    const rootSystem = json.system || json.system_prompt || json.system_instruction || json.instruction_prompt;

    // 0. ChatGPT Export format with mapping object tree
    if (json.mapping && typeof json.mapping === 'object') {
      const nodeMap = json.mapping;
      const nodes = Object.values(nodeMap) as any[];
      const msgNodes = nodes.filter(n => n && n.message && n.message.content && n.message.author);
      msgNodes.sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));

      const parsedMsgs: Message[] = [];
      msgNodes.forEach((node, nIdx) => {
        const roleStr = (node.message.author.role || 'user').toLowerCase();
        const contentStr = extractTextContent(node.message.content.parts || node.message.content);
        if (!contentStr) return;

        if (roleStr === 'system') {
          parsedMsgs.push({ id: `msg-${seed}-${nIdx}`, role: Role.USER, content: `[System Instruction]\n${contentStr}`, comments: [] });
        } else {
          const isModel = ['assistant', 'bot', 'ai', 'model', 'gpt'].includes(roleStr);
          parsedMsgs.push({ id: `msg-${seed}-${nIdx}`, role: isModel ? Role.MODEL : Role.USER, content: contentStr, comments: [] });
        }
      });

      if (parsedMsgs.length > 0) {
        const firstUser = parsedMsgs.find(m => m.role === Role.USER)?.content || '';
        return {
          ...json,
          id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
          title: json.title || firstUser.replace(/^\[System Instruction\]\n?/, '').slice(0, 36) || `${cleanFileName} #${idx + 1}`,
          messages: parsedMsgs,
          createdAt: json.create_time ? json.create_time * 1000 : Date.now()
        };
      }
    }

    // 1. Array of messages nested in various common field names
    const rawMsgArray = Array.isArray(json.messages) ? json.messages :
                        Array.isArray(json.conversations) ? json.conversations :
                        Array.isArray(json.turns) ? json.turns :
                        Array.isArray(json.chat_messages) ? json.chat_messages :
                        Array.isArray(json.dialog) ? json.dialog :
                        Array.isArray(json.history) ? json.history :
                        Array.isArray(json.chat) ? json.chat :
                        Array.isArray(json.items) ? json.items :
                        Array.isArray(json.data) ? json.data : null;

    if (rawMsgArray && rawMsgArray.length > 0) {
      const parsedMsgs: Message[] = [];

      if (rootSystem) {
        parsedMsgs.push({
          id: `msg-${seed}-sys`,
          role: Role.USER,
          content: `[System Instruction]\n${extractTextContent(rootSystem)}`,
          comments: []
        });
      }

      rawMsgArray.forEach((m: any, mIdx: number) => {
        // Support tuple format e.g. history: [["User msg", "Bot msg"], ...]
        if (Array.isArray(m)) {
          if (m.length >= 1) {
            const uStr = extractTextContent(m[0]);
            if (uStr) parsedMsgs.push({ id: `msg-${seed}-${mIdx}-u`, role: Role.USER, content: uStr, comments: [] });
          }
          if (m.length >= 2) {
            const mStr = extractTextContent(m[1]);
            if (mStr) parsedMsgs.push({ id: `msg-${seed}-${mIdx}-m`, role: Role.MODEL, content: mStr, comments: [] });
          }
          return;
        }

        const rawRole = (m.role || m.from || m.author || m.sender || m.speaker || m.type || 'user').toString().toLowerCase();
        const rawContent = m.content !== undefined ? m.content :
                           m.value !== undefined ? m.value :
                           m.text !== undefined ? m.text :
                           m.message !== undefined ? m.message : m;
        const contentStr = extractTextContent(rawContent);

        if (rawRole === 'system') {
          parsedMsgs.push({
            id: m.id ? `${m.id}-${seed}` : `msg-${seed}-${mIdx}`,
            role: Role.USER,
            content: `[System Instruction]\n${contentStr}`,
            comments: Array.isArray(m.comments) ? m.comments : []
          });
        } else {
          const isModel = ['assistant', 'bot', 'ai', 'model', 'gpt', 'agent', 'helper', 'chosen', 'output', 'response'].includes(rawRole);
          parsedMsgs.push({
            id: m.id ? `${m.id}-${seed}` : `msg-${seed}-${mIdx}`,
            role: isModel ? Role.MODEL : Role.USER,
            content: contentStr,
            comments: Array.isArray(m.comments) ? m.comments : []
          });
        }
      });

      const firstUserMsg = parsedMsgs.find(m => m.role === Role.USER)?.content || parsedMsgs[0]?.content;
      const autoTitle = json.title || (typeof firstUserMsg === 'string' && firstUserMsg.trim() ? firstUserMsg.trim().replace(/^\[System Instruction\]\n?/, '').slice(0, 36) : `${cleanFileName} #${idx + 1}`);

      return {
        ...json,
        id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
        title: autoTitle,
        messages: parsedMsgs,
        createdAt: json.createdAt || Date.now()
      };
    }

    // 2. Raw message array
    if (Array.isArray(json)) {
      const parsedMsgs: Message[] = [];
      json.forEach((m: any, mIdx: number) => {
        const rawRole = (m.role || m.from || m.author || m.sender || m.speaker || 'user').toString().toLowerCase();
        const rawContent = m.content !== undefined ? m.content :
                           m.value !== undefined ? m.value :
                           m.text !== undefined ? m.text : m;
        const contentStr = extractTextContent(rawContent);
        if (rawRole === 'system') {
          parsedMsgs.push({ id: `msg-${seed}-${mIdx}`, role: Role.USER, content: `[System Instruction]\n${contentStr}`, comments: [] });
        } else {
          const isModel = ['assistant', 'bot', 'ai', 'model', 'gpt', 'agent', 'helper'].includes(rawRole);
          parsedMsgs.push({ id: `msg-${seed}-${mIdx}`, role: isModel ? Role.MODEL : Role.USER, content: contentStr, comments: [] });
        }
      });

      const firstUserMsg = parsedMsgs.find(m => m.role === Role.USER)?.content || parsedMsgs[0]?.content;
      const autoTitle = typeof firstUserMsg === 'string' && firstUserMsg.trim() ? firstUserMsg.trim().replace(/^\[System Instruction\]\n?/, '').slice(0, 36) : `${cleanFileName} #${idx + 1}`;

      return {
        id: `conv-${seed}`,
        title: autoTitle,
        messages: parsedMsgs,
        createdAt: Date.now()
      };
    }

    // 3. Prompt / Response or Instruction / Input / Output / Q&A / DPO dataset key pairs
    let userParts: string[] = [];
    if (rootSystem) {
      userParts.push(`[System Instruction]\n${extractTextContent(rootSystem)}`);
    }

    if (json.instruction) {
      userParts.push(extractTextContent(json.instruction));
      if (json.input) {
        userParts.push(`Input:\n${extractTextContent(json.input)}`);
      }
    } else {
      const userRaw = json.prompt || json.input || json.question || json.query || json.user || json.human || json.user_prompt || json.src || json.source || json.input_text || json.context;
      if (userRaw !== undefined) {
        userParts.push(extractTextContent(userRaw));
      }
    }

    const modelRaw = json.response || json.output || json.completion || json.answer || json.target || json.assistant || json.result || json.bot || json.model || json.gpt || json.chosen || json.rejected || json.model_response || json.tgt || json.target_text;
    const modelStr = modelRaw !== undefined ? extractTextContent(modelRaw) : '';

    if (userParts.length > 0 || modelStr) {
      const combinedUserText = userParts.join('\n\n');

      const turns = parseTextIntoTurns(combinedUserText, seed);
      if (turns.length > 0) {
        if (modelStr) {
          turns.push({ id: `msg-${seed}-m`, role: Role.MODEL, content: modelStr, comments: [] });
        }
        return {
          ...json,
          id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
          title: json.title || turns.find(t => t.role === Role.USER)?.content.replace(/^\[System Instruction\]\n?/, '').slice(0, 36) || `${cleanFileName} #${idx + 1}`,
          messages: turns,
          createdAt: json.createdAt || Date.now()
        };
      }

      const msgs: Message[] = [];
      if (combinedUserText) {
        msgs.push({ id: `msg-${seed}-0`, role: Role.USER, content: combinedUserText, comments: [] });
      }
      if (modelStr) {
        msgs.push({ id: `msg-${seed}-1`, role: Role.MODEL, content: modelStr, comments: [] });
      }

      return {
        ...json,
        id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
        title: json.title || (combinedUserText || modelStr || '').trim().replace(/^\[System Instruction\]\n?/, '').slice(0, 36) || `${cleanFileName} #${idx + 1}`,
        messages: msgs,
        createdAt: json.createdAt || Date.now()
      };
    }

    // 4. Fallback for text/content fields
    const fallbackText = json.text || json.content || json.body || json.message || json.data || json.doc || json.payload || json.description;
    if (fallbackText !== undefined) {
      const textStr = extractTextContent(fallbackText);
      const turns = parseTextIntoTurns(textStr, seed);
      if (turns.length > 0) {
        return {
          ...json,
          id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
          title: json.title || turns.find(t => t.role === Role.USER)?.content.slice(0, 36) || `${cleanFileName} #${idx + 1}`,
          messages: turns,
          createdAt: json.createdAt || Date.now()
        };
      }
      return {
        ...json,
        id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
        title: json.title || textStr.trim().slice(0, 36) || `${cleanFileName} #${idx + 1}`,
        messages: [
          { id: `msg-${seed}-0`, role: Role.USER, content: textStr, comments: [] }
        ],
        createdAt: json.createdAt || Date.now()
      };
    }

    // 5. Safe fallback for arbitrary JSON structure
    const metaKeys = ['temperature', 'top_p', 'top_k', 'model', 'id', 'created_at', 'timestamp', 'max_tokens'];
    const entries = Object.entries(json)
      .filter(([k, v]) => v !== undefined && v !== null && !metaKeys.includes(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);

    const entriesStr = entries.join('\n\n');

    return {
      ...json,
      id: json.id ? `${json.id}-${seed}` : `conv-${seed}`,
      title: json.title || `${cleanFileName} #${idx + 1}`,
      messages: [
        { id: `msg-${seed}-0`, role: Role.USER, content: entriesStr || JSON.stringify(json), comments: [] }
      ],
      createdAt: json.createdAt || Date.now()
    };
  };

  const parseJsonlContent = (fileName: string, textContent: string): Conversation[] => {
    const cleanText = textContent.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      throw new Error("JSONL file is empty.");
    }

    const conversations: Conversation[] = [];
    const errors: string[] = [];

    lines.forEach((line, idx) => {
      try {
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          parsed = { text: line };
        }
        const conv = convertJsonObjectToConversation(parsed, idx, fileName);
        conversations.push(conv);
      } catch (err: any) {
        errors.push(`Line ${idx + 1}: ${err?.message || "Invalid JSON"}`);
      }
    });

    if (conversations.length === 0) {
      throw new Error(`Failed to parse valid JSONL lines. (${errors.slice(0, 2).join('; ')})`);
    }

    return conversations;
  };

  const parseUploadedFile = (fileName: string, textContent: string): Conversation[] => {
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith('.jsonl') || lowerName.endsWith('.jsonlines')) {
      return parseJsonlContent(fileName, textContent);
    } else if (lowerName.endsWith('.json')) {
      try {
        const json = JSON.parse(textContent);
        if (Array.isArray(json)) {
          return json.map((item, idx) => convertJsonObjectToConversation(item, idx, fileName));
        } else if (json && typeof json === 'object' && Array.isArray(json.conversations)) {
          // Wrapper object shape, e.g. { _meta: {...}, conversations: [...] } -
          // treat the conversations array the same as a top-level array.
          return json.conversations.map((item: any, idx: number) => convertJsonObjectToConversation(item, idx, fileName));
        } else {
          return [convertJsonObjectToConversation(json, 0, fileName)];
        }
      } catch {
        // Fallback: If standard JSON parsing fails, try parsing line-by-line as JSONL
        try {
          return parseJsonlContent(fileName, textContent);
        } catch {
          throw new Error("Invalid JSON format. Expected a JSON object, JSON array, or JSONL file.");
        }
      }
    } else if (lowerName.endsWith('.txt')) {
      // Parse txt
      const lines = textContent.split('\n');
      
      // Helper function to detect speaker and strip timestamp/role formatting
      const matchSpeaker = (lineStr: string): { role: Role; content: string } | null => {
        const cleaned = lineStr.trim();
        if (!cleaned) return null;

        // 1. Strip timestamp at start if any
        const tsRegex = /^(?:[\[\(]?\d{4}[-\/\.]\d{2}[-\/\.]\d{2}[\s,T_]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?[\]\)]?|[\[\(]?\d{2}:\d{2}(?::\d{2})?[\]\)]?)\s*/i;
        const withoutTs = cleaned.replace(tsRegex, '').trim();

        // 2. Check full words with optional colon (e.g., "USER: hello", "[USER] hello", "USER hello")
        const wordPattern = /^[\[\(]?(user|human|customer|client|sender|buyer|gebruiker|caller|model|assistant|ai|bot|agent|helper|system)[\]\)]?\s*(?::|-|=)?\s*(.*)$/i;
        const wordMatch = withoutTs.match(wordPattern);
        if (wordMatch) {
          const roleWord = wordMatch[1].toLowerCase();
          const isUser = ['user', 'human', 'customer', 'client', 'sender', 'buyer', 'gebruiker', 'caller'].includes(roleWord);
          const isModel = ['model', 'assistant', 'ai', 'bot', 'agent', 'helper'].includes(roleWord);
          
          const hasSeparator = withoutTs.includes(':') || withoutTs.includes('-') || withoutTs.includes('=') || withoutTs.startsWith('[') || withoutTs.startsWith('(');
          const isStandalone = wordMatch[2].trim() === '';
          
          if (isUser && (hasSeparator || isStandalone || ['user', 'human', 'customer'].includes(roleWord))) {
            return { role: Role.USER, content: wordMatch[2].trim() };
          }
          if (isModel && (hasSeparator || isStandalone || ['model', 'assistant', 'ai', 'bot'].includes(roleWord))) {
            return { role: Role.MODEL, content: wordMatch[2].trim() };
          }
        }

        // 3. Check single letters with strict colon/separator/bracket requirement (e.g., "u: hello", "[m] hello")
        const singleLetterPattern = /^[\[\(]?(u|m|a|h|c)[\]\)]?\s*(?::|-|=)\s*(.*)$/i;
        const singleMatch = withoutTs.match(singleLetterPattern);
        if (singleMatch) {
          const letter = singleMatch[1].toLowerCase();
          if (['u', 'h', 'c'].includes(letter)) {
            return { role: Role.USER, content: singleMatch[2].trim() };
          }
          if (['m', 'a'].includes(letter)) {
            return { role: Role.MODEL, content: singleMatch[2].trim() };
          }
        }

        return null;
      };

      // 1. Scan the file first to check if there are any speaker headers
      let hasSpeakerHeaders = false;
      for (const line of lines) {
        if (matchSpeaker(line)) {
          hasSpeakerHeaders = true;
          break;
        }
      }

      const parsedMessages: Message[] = [];

      if (hasSpeakerHeaders) {
        let currentRole: Role | null = null;
        let currentTextLines: string[] = [];
        let counter = 0;

        for (const line of lines) {
          const speaker = matchSpeaker(line);
          if (speaker) {
            // Push accumulated text of the previous block
            if (currentRole && currentTextLines.length > 0) {
              parsedMessages.push({
                id: `msg-${Date.now()}-${counter++}`,
                role: currentRole,
                content: currentTextLines.join('\n').trim(),
                comments: []
              });
            }
            currentRole = speaker.role;
            currentTextLines = speaker.content ? [speaker.content] : [];
          } else {
            const trimmedLine = line.trim();
            if (trimmedLine) {
              if (currentRole) {
                currentTextLines.push(line);
              } else {
                currentRole = Role.USER;
                currentTextLines.push(line);
              }
            } else if (currentTextLines.length > 0) {
              currentTextLines.push('');
            }
          }
        }

        // Push final message block
        if (currentRole && currentTextLines.length > 0) {
          const finalContent = currentTextLines.join('\n').trim();
          if (finalContent) {
            parsedMessages.push({
              id: `msg-${Date.now()}-${counter++}`,
              role: currentRole,
              content: finalContent,
              comments: []
            });
          }
        }
      } else {
        // Fallback: alternate blocks or lines when no speaker headers exist
        let blocks = textContent.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
        if (blocks.length <= 1) {
          blocks = lines.map(l => l.trim()).filter(Boolean);
        }

        blocks.forEach((block, idx) => {
          parsedMessages.push({
            id: `msg-${Date.now()}-${idx}`,
            role: idx % 2 === 0 ? Role.USER : Role.MODEL,
            content: block,
            comments: []
          });
        });
      }

      if (parsedMessages.length === 0) {
        throw new Error("The text file is empty or could not be parsed.");
      }

      const newConv: Conversation = {
        id: `conv-${Date.now()}`,
        title: fileName.replace(/\.txt$/i, '') || 'Uploaded Text Conversation',
        messages: parsedMessages,
        createdAt: Date.now()
      };
      return [newConv];
    } else {
      throw new Error("Unsupported file type. Please upload a .json, .jsonl, or .txt file.");
    }
  };

  const parseFile = (file: File): Promise<Conversation[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const textContent = e.target?.result as string;
          const convs = parseUploadedFile(file.name, textContent);
          resolve(convs);
        } catch (err: any) {
          reject(new Error(`${file.name}: ${err?.message || "Failed to parse"}`));
        }
      };
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsText(file);
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setError(null);

    const parsedConvs: Conversation[] = [];
    const errors: string[] = [];

    // Determine target folder for uploads
    const activeUploadFolder = targetUploadFolderId || (selectedFolderId !== 'ALL' && selectedFolderId !== 'UNASSIGNED' ? selectedFolderId : undefined);

    const promises = Array.from(files).map(async (file) => {
      try {
        const convs = await parseFile(file);
        for (const conv of convs) {
          const category = conv.category || 'Uncategorized';
          const folderId = conv.folderId || activeUploadFolder;
          parsedConvs.push({ ...conv, category, folderId });
        }
      } catch (err: any) {
        errors.push(err?.message || `Failed to process ${file.name}`);
      }
    });

    await Promise.all(promises);

    if (parsedConvs.length > 0) {
      // Add all new conversations to the top of the list
      setConversations(prev => [...parsedConvs, ...prev]);
      if (parsedConvs.length === 1) {
        setCurrentConversation(parsedConvs[0]);
        setViewState('editor');
      } else {
        setViewState('dashboard');
      }
    }

    if (errors.length > 0) {
      setError(`Some files failed to import:\n${errors.join('\n')}`);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    handleFiles(files);
    event.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    handleFiles(files);
  };

  const handleEvaluate = async () => {
    if (!currentConversation) return;
    setIsEvaluating(true);
    setError(null);
    try {
      let factCheckData = undefined;
      
      // Step 1: Run Fact Check if enabled
      if (enableFactCheck) {
        factCheckData = await performFactCheck(currentConversation);
      }

      // Step 2: Run Main Evaluation
      const result = await evaluateConversation(currentConversation, criteria, factCheckData);
      
      const updatedConv = { ...currentConversation, evaluation: result };
      updateConversationState(updatedConv);
    } catch (e: any) {
      setError(e?.message || "Evaluation failed. Please check your API key and try again.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const updateConversationState = (updated: Conversation) => {
    setCurrentConversation(updated);
    setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
  };

  const handleMessageUpdate = (msgId: string, updates: Partial<Message>) => {
    if (!currentConversation) return;
    const newMessages = currentConversation.messages.map(m => 
      m.id === msgId ? { ...m, ...updates } : m
    );
    updateConversationState({ ...currentConversation, messages: newMessages });
  };

  const handleUpdateContext = (field: 'domainContext' | 'referenceContext', value: string) => {
    if (!currentConversation) return;
    updateConversationState({ ...currentConversation, [field]: value });
  };

  const handleAddComment = (msgId: string, text: string) => {
    if (!currentConversation) return;
    const newComment: Comment = { id: `c-${Date.now()}`, text, timestamp: Date.now() };
    const newMessages = (currentConversation.messages || []).map(m => 
      m.id === msgId ? { ...m, comments: [...(m.comments || []), newComment] } : m
    );
    updateConversationState({ ...currentConversation, messages: newMessages });
  };

  const handleDeleteComment = (msgId: string, commentId: string) => {
    if (!currentConversation) return;
    const newMessages = (currentConversation.messages || []).map(m => 
      m.id === msgId ? { ...m, comments: (m.comments || []).filter(c => c.id !== commentId) } : m
    );
    updateConversationState({ ...currentConversation, messages: newMessages });
  };

  const handleResetCriteria = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset Evaluation Criteria',
      message: 'Are you sure you want to reset all evaluation metrics to defaults?',
      confirmLabel: 'Reset Defaults',
      onConfirm: () => {
        setCriteria(DEFAULT_CRITERIA);
        setConfirmModal(null);
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setViewState('dashboard')}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">M</div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">MatchEval</h1>
          </div>
          <div className="flex items-center gap-3">
             <button 
               onClick={() => setViewState('settings')}
               className={`text-sm font-semibold px-3 py-2 rounded-lg transition-colors ${viewState === 'settings' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
             >
               System Settings
             </button>
             {viewState === 'editor' && (
               <>
                 <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 gap-1 select-none">
                   <button 
                     type="button"
                     onClick={() => handleExportConversation('json')} 
                     title="Download JSON (Raw Conversation Data & Evaluation)"
                     className="px-2.5 py-1 text-xs font-bold text-gray-750 hover:bg-white rounded transition-colors"
                   >
                     JSON
                   </button>
                   <button 
                     type="button"
                     onClick={() => handleExportConversation('txt')} 
                     title="Download Text Evaluation Report"
                     className="px-2.5 py-1 text-xs font-bold text-gray-750 hover:bg-white rounded transition-colors"
                   >
                     TXT Report
                   </button>
                   <button 
                     type="button"
                     onClick={() => handleExportConversation('md')} 
                     title="Download Markdown Report"
                     className="px-2.5 py-1 text-xs font-bold text-gray-750 hover:bg-white rounded transition-colors"
                   >
                     Markdown
                   </button>
                 </div>
                 <Button variant="ghost" size="sm" onClick={() => setViewState('dashboard')}>Back to Dashboard</Button>
               </>
             )}
             <div className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg hidden sm:block font-bold select-none uppercase tracking-wide">
               Active Engine: {activeProvider}
             </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8">
        {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
                <span className="block sm:inline">{error}</span>
                <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>✕</span>
            </div>
        )}

        {viewState === 'dashboard' && (
          <div 
            className={`space-y-6 animate-in fade-in duration-500 rounded-2xl transition-all ${
              isDragging ? 'bg-indigo-50/50 p-6 ring-4 ring-indigo-500/10 shadow-inner' : ''
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Top Bar: Title & Upload Controls */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
                <p className="text-gray-500 text-xs mt-0.5">Organize conversations in folders, filter categories, and evaluate AI performance.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
                 {/* Upload Target Folder Selector */}
                 <div className="flex items-center gap-1.5 text-xs font-semibold bg-gray-50 border border-gray-250 rounded-lg px-2.5 py-1.5 shadow-2xs">
                   <span className="text-gray-500 font-bold hidden sm:inline">Upload into:</span>
                   <select
                     value={targetUploadFolderId}
                     onChange={(e) => {
                       if (e.target.value === '__NEW__') {
                         setShowNewFolderModal(true);
                       } else {
                         setTargetUploadFolderId(e.target.value);
                       }
                     }}
                     className="bg-transparent border-none text-xs font-bold text-indigo-700 focus:ring-0 focus:outline-none cursor-pointer pr-1"
                   >
                     <option value="">📁 Default (Auto)</option>
                     {folders.map(f => (
                       <option key={f.id} value={f.id}>📁 {f.name}</option>
                     ))}
                     <option value="__NEW__">➕ + Create New Folder...</option>
                   </select>
                 </div>

                 <label className="cursor-pointer inline-flex items-center justify-center rounded-lg font-bold transition-all focus:outline-none bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 text-xs shadow-xs select-none">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Upload Files</span>
                    <input type="file" multiple className="hidden" accept=".json,.jsonl,.txt,.jsonlines,application/json,text/plain,text/json,application/x-jsonlines,*" onChange={handleFileUpload} />
                 </label>
                 
                 <Button variant="secondary" size="sm" onClick={handleCreateNew} isLoading={isEvaluating}>
                   Generate Sample
                 </Button>
              </div>
            </div>

            {/* Folder Tabs / Navigation Bar */}
            <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-2xs space-y-2.5 select-none">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                  Folders ({folders.length})
                </span>
                <button
                  onClick={() => setShowNewFolderModal(true)}
                  className="text-xs font-bold text-indigo-650 hover:text-indigo-800 flex items-center gap-1 hover:underline cursor-pointer bg-indigo-50 hover:bg-indigo-100/80 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Create Folder
                </button>
              </div>

              <div className="flex gap-2 flex-wrap items-center">
                {/* All Conversations */}
                <button
                  onClick={() => setSelectedFolderId('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 flex items-center gap-2 cursor-pointer ${
                    selectedFolderId === 'ALL'
                      ? 'bg-indigo-650 text-white border-indigo-650 shadow-xs ring-2 ring-indigo-500/10 font-bold'
                      : 'bg-slate-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <span>📁 All Conversations</span>
                  <span className={`text-[10px] px-2 py-0.2 rounded-full font-black ${selectedFolderId === 'ALL' ? 'bg-indigo-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
                    {conversations.length}
                  </span>
                </button>

                {/* Unassigned Folder */}
                <button
                  onClick={() => setSelectedFolderId('UNASSIGNED')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 flex items-center gap-2 cursor-pointer ${
                    selectedFolderId === 'UNASSIGNED'
                      ? 'bg-indigo-650 text-white border-indigo-650 shadow-xs ring-2 ring-indigo-500/10 font-bold'
                      : 'bg-slate-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <span>📂 Unassigned</span>
                  <span className={`text-[10px] px-2 py-0.2 rounded-full font-black ${selectedFolderId === 'UNASSIGNED' ? 'bg-indigo-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
                    {conversations.filter(c => !c.folderId).length}
                  </span>
                </button>

                {/* Custom Folders */}
                {folders.map(folder => {
                  const count = conversations.filter(c => c.folderId === folder.id).length;
                  const isSelected = selectedFolderId === folder.id;
                  const colorInfo = getFolderColorClasses(folder.color);

                  return (
                    <div key={folder.id} className="relative group">
                      <button
                        onClick={() => setSelectedFolderId(folder.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 flex items-center gap-2 cursor-pointer pr-7 ${
                          isSelected
                            ? 'bg-indigo-650 text-white border-indigo-650 shadow-xs ring-2 ring-indigo-500/10'
                            : `${colorInfo.bg} ${colorInfo.text} ${colorInfo.border} hover:opacity-90`
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white' : colorInfo.dot}`}></span>
                        <span>{folder.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${isSelected ? 'bg-indigo-800 text-white' : 'bg-white/90 text-gray-700 border border-gray-200'}`}>
                          {count}
                        </span>
                      </button>
                      <button
                        onClick={(e) => handleDeleteFolder(folder.id, e)}
                        title="Delete folder"
                        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded ${isSelected ? 'text-white hover:text-red-200' : 'text-gray-400 hover:text-red-500'}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Drag feedback card overlay when list is loaded but user drags a file */}
            {isDragging && conversations.length > 0 && (
              <div className="py-12 text-center bg-indigo-50/80 rounded-2xl border-2 border-dashed border-indigo-500 text-indigo-800 backdrop-blur-xs flex flex-col items-center justify-center space-y-2 animate-in zoom-in duration-200">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-bounce text-indigo-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <p className="font-extrabold text-lg">Drop your JSON, JSONL, or TXT file to import conversation</p>
                <p className="text-xs font-semibold text-indigo-600">Supports MatchEval exports, JSONL datasets, raw message arrays, or formatted transcripts</p>
              </div>
            )}

            {conversations.length > 0 && (
              <div className="mb-6 bg-white p-4 rounded-xl border border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs select-none animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center h-5">
                    <input 
                      type="checkbox"
                      id="selectAll"
                      checked={selectedIds.length === conversations.length && conversations.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(conversations.map(c => c.id));
                        } else {
                          setSelectedIds([]);
                        }
                      }}
                      className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
                      disabled={bulkEvalProgress?.running}
                    />
                  </div>
                  <label htmlFor="selectAll" className="text-sm font-bold text-gray-800 cursor-pointer">
                    Select All ({conversations.length})
                  </label>

                  {/* One-Key Analyze All Shortcut Button next to Select All */}
                  {(!bulkEvalProgress || !bulkEvalProgress.running) && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleAnalyzeAll}
                      isLoading={isEvaluating}
                      className="bg-indigo-650 hover:bg-indigo-700 text-white font-bold flex items-center gap-1.5 shadow-xs text-xs px-3 py-1.5 cursor-pointer ml-1"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-pulse">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                      </svg>
                      One-Key Analyze All ({conversations.length})
                    </Button>
                  )}

                  {selectedIds.length > 0 && selectedIds.length < conversations.length && (
                    <span className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full font-bold">
                      {selectedIds.length} Selected
                    </span>
                  )}
                </div>
                
                {bulkEvalProgress && bulkEvalProgress.running ? (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-indigo-50/70 border border-indigo-150 rounded-xl py-2 px-4 w-full sm:w-auto flex-1 max-w-lg sm:ml-4 shadow-2xs">
                    <div className="flex items-center justify-between w-full sm:w-auto md:min-w-[140px] gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-xs font-extrabold text-indigo-900 tracking-tight whitespace-nowrap">
                          Analyzing {bulkEvalProgress.current} / {bulkEvalProgress.total}
                        </span>
                      </div>
                      <button 
                        onClick={() => { cancelBulkRef.current = true; }} 
                        className="text-[10px] text-red-650 font-black hover:underline hover:text-red-700 cursor-pointer uppercase tracking-wider ml-1 px-1.5 py-0.5 rounded-md hover:bg-red-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {/* Progress Bar Container */}
                    <div className="h-2 bg-indigo-100 rounded-full flex-1 min-w-[120px] overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${(bulkEvalProgress.current / bulkEvalProgress.total) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                ) : (
                  selectedIds.length > 0 && (
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto items-center justify-end">
                      {/* One-key Analyze Button */}
                      <Button 
                        variant="primary" 
                        size="sm"
                        onClick={handleBulkEvaluate}
                        isLoading={isEvaluating}
                        className="bg-indigo-650 hover:bg-indigo-700 text-white font-bold flex items-center gap-1.5 shadow-xs"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-pulse">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                        </svg>
                        One-Key Analyze Selected ({selectedIds.length})
                      </Button>

                      {/* Bulk Move to Folder */}
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value === '__NEW__') {
                            setShowNewFolderModal(true);
                          } else if (e.target.value) {
                            handleMoveSelectedToFolder(e.target.value);
                          }
                        }}
                        className="bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg px-2.5 py-1.5 cursor-pointer focus:ring-2 focus:ring-indigo-500 shadow-2xs hover:bg-gray-50"
                      >
                        <option value="">Move to Folder ▾</option>
                        <option value="UNASSIGNED">📂 Unassign / Remove Folder</option>
                        {folders.map(f => (
                          <option key={f.id} value={f.id}>📁 {f.name}</option>
                        ))}
                        <option value="__NEW__">➕ Create New Folder...</option>
                      </select>

                      {/* Bulk Delete */}
                      <button
                        onClick={handleDeleteSelected}
                        className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Delete
                      </button>

                      <span className="text-gray-300 self-center mx-1 font-semibold hidden sm:block">|</span>
                      
                      <span className="text-[11px] text-gray-400 self-center mr-1 font-extrabold uppercase tracking-wider hidden sm:block">Export:</span>
                      
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => handleBulkExport('json')}
                        disabled={isEvaluating}
                      >
                        JSON
                      </Button>

                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => handleBulkExport('txt')}
                        disabled={isEvaluating}
                      >
                        TXT
                      </Button>

                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => handleBulkExport('md')}
                        disabled={isEvaluating}
                      >
                        Markdown
                      </Button>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Filter & View Mode Bar */}
            {conversations.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between select-none bg-slate-50 p-2.5 rounded-xl border border-gray-200 shadow-2xs">
                {/* Category Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                    Category:
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    {(['All', 'Normal', 'Edge Case', 'Multilingual', 'Sensitive', 'Uncategorized'] as const).map(cat => {
                      const count = cat === 'All' 
                        ? conversations.filter(c => {
                            if (selectedFolderId === 'UNASSIGNED') return !c.folderId;
                            if (selectedFolderId !== 'ALL') return c.folderId === selectedFolderId;
                            return true;
                          }).length 
                        : conversations.filter(c => {
                            if (selectedFolderId === 'UNASSIGNED' && c.folderId) return false;
                            if (selectedFolderId !== 'ALL' && selectedFolderId !== 'UNASSIGNED' && c.folderId !== selectedFolderId) return false;
                            return c.category === cat || (cat === 'Uncategorized' && !c.category);
                          }).length;

                      return (
                        <button
                          key={cat}
                          onClick={() => setCategoryFilter(cat)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${
                            categoryFilter === cat
                              ? 'bg-indigo-650 text-white border-indigo-650 shadow-xs font-bold'
                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <span>{cat}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${categoryFilter === cat ? 'bg-indigo-700 text-indigo-50' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* View Switcher Toggle (Grid vs List) */}
                <div className="flex bg-white p-1 rounded-xl border border-gray-250 shadow-2xs gap-1 self-end sm:self-center">
                  <button
                    onClick={() => handleViewModeChange('grid')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                      viewMode === 'grid' ? 'bg-indigo-650 text-white shadow-2xs' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                    }`}
                    title="Grid View (Icon View)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                    <span>Icon View</span>
                  </button>
                  <button
                    onClick={() => handleViewModeChange('list')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                      viewMode === 'list' ? 'bg-indigo-650 text-white shadow-2xs' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                    }`}
                    title="List View"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    <span>List View</span>
                  </button>
                </div>
              </div>
            )}

            {/* Conversation Display Area */}
            {(() => {
              const filteredList = conversations.filter(conv => {
                if (selectedFolderId === 'UNASSIGNED') {
                  if (conv.folderId) return false;
                } else if (selectedFolderId !== 'ALL') {
                  if (conv.folderId !== selectedFolderId) return false;
                }

                if (categoryFilter === 'All') return true;
                if (categoryFilter === 'Uncategorized') return !conv.category || conv.category === 'Uncategorized';
                return conv.category === categoryFilter;
              });

              if (conversations.length === 0) {
                return (
                  <div className={`py-20 text-center bg-white rounded-2xl border-2 border-dashed ${isDragging ? 'border-indigo-600 bg-indigo-50/20 text-indigo-700' : 'border-gray-200'} transition-all`}>
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <div className={`p-4 rounded-full bg-indigo-50 text-indigo-600 ${isDragging ? 'scale-110 bg-indigo-100 text-indigo-800 animate-pulse' : ''} transition-all`}>
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        </div>
                        <p className="text-gray-900 font-extrabold text-lg">
                          {isDragging ? 'Drop your file now!' : 'No conversations found'}
                        </p>
                        <p className="text-gray-500 text-sm max-w-sm px-4 leading-relaxed">
                          Drag and drop your AI conversation logs as <strong>.json</strong>, <strong>.jsonl</strong>, or <strong>.txt</strong> here, or upload manual transcripts to evaluate.
                        </p>
                        <div className="flex gap-2 pt-2">
                          <label className="cursor-pointer inline-flex items-center justify-center rounded-lg font-bold transition-colors bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm shadow-sm select-none">
                            Browse Files
                            <input type="file" multiple className="hidden" accept=".json,.jsonl,.txt,.jsonlines,application/json,text/plain,text/json,application/x-jsonlines,*" onChange={handleFileUpload} />
                          </label>
                          <Button variant="secondary" onClick={handleCreateNew} isLoading={isEvaluating}>Generate Sample</Button>
                        </div>
                      </div>
                  </div>
                );
              }

              if (filteredList.length === 0) {
                return (
                  <div className="py-16 text-center bg-white rounded-2xl border border-gray-200">
                    <div className="flex flex-col items-center justify-center space-y-2 animate-in zoom-in-95 duration-200">
                      <div className="p-3.5 rounded-full bg-slate-50 text-slate-400">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                      </div>
                      <p className="text-gray-950 font-bold">No conversations in this folder or category</p>
                      <p className="text-gray-500 text-xs">Try switching folders or clearing category filters.</p>
                      <button onClick={() => { setCategoryFilter('All'); setSelectedFolderId('ALL'); }} className="mt-2 text-xs text-indigo-650 font-extrabold hover:underline cursor-pointer">
                        Reset Filters
                      </button>
                    </div>
                  </div>
                );
              }

              if (viewMode === 'grid') {
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredList.map(conv => {
                      const folder = folders.find(f => f.id === conv.folderId);
                      const folderColorInfo = getFolderColorClasses(folder?.color);

                      return (
                       <div 
                         key={conv.id} 
                         onClick={() => handleSelectConversation(conv)}
                         className={`group bg-white rounded-xl border p-5 hover:shadow-lg transition-all cursor-pointer relative flex flex-col justify-between ${selectedIds.includes(conv.id) ? 'border-indigo-500 ring-2 ring-indigo-500/10 bg-indigo-50/5' : 'border-gray-200'}`}
                       >
                         <div>
                           <div className="flex justify-between items-start mb-3 gap-2">
                              <div className="flex items-center gap-2.5 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                <input 
                                  type="checkbox"
                                  checked={selectedIds.includes(conv.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setSelectedIds(prev => checked ? [...prev, conv.id] : prev.filter(id => id !== conv.id));
                                  }}
                                  className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer flex-shrink-0"
                                />
                                <h3 className="font-bold text-base text-gray-900 line-clamp-1 truncate">{conv.title}</h3>
                              </div>
                              <button onClick={(e) => deleteConversation(conv.id, e)} className="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-pointer">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                              </button>
                           </div>
                          
                           <div className="flex flex-wrap gap-1.5 items-center mb-4" onClick={(e) => e.stopPropagation()}>
                             <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border select-none ${
                               conv.category === 'Normal'      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                               conv.category === 'Edge Case'   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                               conv.category === 'Multilingual'? 'bg-sky-50 text-sky-700 border-sky-100' :
                               conv.category === 'Sensitive'   ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                                 'bg-slate-50 text-slate-600 border-slate-200'
                             }`}>
                               <div className="flex items-center gap-1 py-0.5">
                                 <span>{conv.category || 'Uncategorized'}</span>
                                 <span className="opacity-40">|</span>
                                 <select
                                   value={conv.category || 'Uncategorized'}
                                   onChange={(e) => {
                                     const newCat = e.target.value as ConversationCategory;
                                     setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, category: newCat } : c));
                                     if (currentConversation && currentConversation.id === conv.id) {
                                       setCurrentConversation(prev => prev ? { ...prev, category: newCat } : null);
                                     }
                                   }}
                                   className="bg-transparent border-none text-[10px] font-extrabold text-current p-0 focus:ring-0 focus:outline-none cursor-pointer pr-1 uppercase"
                                 >
                                   <option value="Uncategorized" className="text-gray-950 font-bold bg-white">Uncategorized</option>
                                   <option value="Normal" className="text-gray-950 font-bold bg-white">Normal</option>
                                   <option value="Edge Case" className="text-gray-950 font-bold bg-white">Edge Case</option>
                                   <option value="Multilingual" className="text-gray-950 font-bold bg-white">Multilingual</option>
                                   <option value="Sensitive" className="text-gray-950 font-bold bg-white">Sensitive</option>
                                 </select>
                               </div>
                             </span>

                             <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border select-none ${
                               folder ? `${folderColorInfo.bg} ${folderColorInfo.text} ${folderColorInfo.border}` : 'bg-gray-50 text-gray-500 border-gray-200'
                             }`}>
                               <span className="mr-1">📁</span>
                               <select
                                 value={conv.folderId || ''}
                                 onChange={(e) => {
                                   if (e.target.value === '__NEW__') {
                                     setShowNewFolderModal(true);
                                   } else {
                                     handleMoveSingleToFolder(conv.id, e.target.value, e);
                                   }
                                 }}
                                 className="bg-transparent border-none text-[10px] font-bold text-current p-0 focus:ring-0 focus:outline-none cursor-pointer pr-1"
                               >
                                 <option value="" className="text-gray-900 bg-white">Unassigned</option>
                                 {folders.map(f => (
                                   <option key={f.id} value={f.id} className="text-gray-900 bg-white">{f.name}</option>
                                 ))}
                                 <option value="__NEW__" className="text-indigo-600 font-bold bg-white">+ New Folder...</option>
                               </select>
                             </span>
                           </div>
                         </div>
                        
                         <div className="flex justify-between items-end pt-3 border-t border-gray-100">
                            <div className="text-xs text-gray-400 font-medium">
                               {conv.messages.length} turns • {new Date(conv.createdAt).toLocaleDateString()}
                            </div>
                            {conv.evaluation ? (
                              <div className="text-right">
                                <div className="text-xl font-black text-indigo-600">{conv.evaluation.overallScore}<span className="text-xs text-gray-400 font-normal">/10</span></div>
                                <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wide">Score</div>
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">
                                Draft
                              </span>
                            )}
                         </div>
                       </div>
                      );
                    })}
                  </div>
                );
              }

              return (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-gray-500 text-[11px] uppercase tracking-wider font-extrabold border-b border-gray-200 select-none">
                        <tr>
                          <th className="py-3.5 px-4 w-10"></th>
                          <th className="py-3.5 px-4">Conversation</th>
                          <th className="py-3.5 px-4">Category</th>
                          <th className="py-3.5 px-4">Folder</th>
                          <th className="py-3.5 px-4">Score</th>
                          <th className="py-3.5 px-4">Turns / Date</th>
                          <th className="py-3.5 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-150">
                        {filteredList.map(conv => {
                          const folder = folders.find(f => f.id === conv.folderId);
                          const folderColorInfo = getFolderColorClasses(folder?.color);
                          const firstMsg = conv.messages[0]?.content || '';
                          const isSelected = selectedIds.includes(conv.id);

                          return (
                            <tr
                              key={conv.id}
                              onClick={() => handleSelectConversation(conv)}
                              className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${isSelected ? 'bg-indigo-50/30' : ''}`}
                            >
                              <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setSelectedIds(prev => checked ? [...prev, conv.id] : prev.filter(id => id !== conv.id));
                                  }}
                                  className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-3.5 px-4 max-w-xs md:max-w-md">
                                <div className="font-bold text-gray-900 truncate text-sm">{conv.title}</div>
                                <div className="text-xs text-gray-400 truncate mt-0.5">{firstMsg}</div>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                  conv.category === 'Normal'      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  conv.category === 'Edge Case'   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  conv.category === 'Multilingual'? 'bg-sky-50 text-sky-700 border-sky-100' :
                                  conv.category === 'Sensitive'   ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                                    'bg-slate-50 text-slate-600 border-slate-200'
                                }`}>
                                  <div className="flex items-center gap-1 py-0.5">
                                    <span>{conv.category || 'Uncategorized'}</span>
                                    <span className="opacity-40">|</span>
                                    <select
                                      value={conv.category || 'Uncategorized'}
                                      onChange={(e) => {
                                        const newCat = e.target.value as ConversationCategory;
                                        setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, category: newCat } : c));
                                        if (currentConversation && currentConversation.id === conv.id) {
                                          setCurrentConversation(prev => prev ? { ...prev, category: newCat } : null);
                                        }
                                      }}
                                      className="bg-transparent border-none text-[10px] font-extrabold text-current p-0 focus:ring-0 focus:outline-none cursor-pointer pr-1 uppercase"
                                    >
                                      <option value="Uncategorized" className="text-gray-950 font-bold bg-white">Uncategorized</option>
                                      <option value="Normal" className="text-gray-950 font-bold bg-white">Normal</option>
                                      <option value="Edge Case" className="text-gray-950 font-bold bg-white">Edge Case</option>
                                      <option value="Multilingual" className="text-gray-950 font-bold bg-white">Multilingual</option>
                                      <option value="Sensitive" className="text-gray-950 font-bold bg-white">Sensitive</option>
                                    </select>
                                  </div>
                                </span>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  folder ? `${folderColorInfo.bg} ${folderColorInfo.text} ${folderColorInfo.border}` : 'bg-gray-50 text-gray-500 border-gray-200'
                                }`}>
                                  <span className="mr-1">📁</span>
                                  <select
                                    value={conv.folderId || ''}
                                    onChange={(e) => {
                                      if (e.target.value === '__NEW__') {
                                        setShowNewFolderModal(true);
                                      } else {
                                        handleMoveSingleToFolder(conv.id, e.target.value, e);
                                      }
                                    }}
                                    className="bg-transparent border-none text-[10px] font-bold text-current p-0 focus:ring-0 focus:outline-none cursor-pointer pr-1"
                                  >
                                    <option value="" className="text-gray-900 bg-white">Unassigned</option>
                                    {folders.map(f => (
                                      <option key={f.id} value={f.id} className="text-gray-900 bg-white">{f.name}</option>
                                    ))}
                                    <option value="__NEW__" className="text-indigo-600 font-bold bg-white">+ New Folder...</option>
                                  </select>
                                </span>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                {conv.evaluation ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    ★ {conv.evaluation.overallScore} / 10
                                  </span>
                                ) : (
                                  <span className="text-xs font-semibold text-gray-400">Unanalyzed</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap text-xs text-gray-500">
                                <div>{conv.messages.length} turns</div>
                                <div className="text-[10px] text-gray-400">{new Date(conv.createdAt).toLocaleDateString()}</div>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleSelectConversation(conv)}
                                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                                  >
                                    View / Edit
                                  </button>
                                  <button
                                    onClick={(e) => deleteConversation(conv.id, e)}
                                    className="text-gray-400 hover:text-red-500 p-1 transition-colors cursor-pointer"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Create New Folder Modal */}
            {showNewFolderModal && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in zoom-in-95 duration-200 select-none">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">📁</span> Create New Folder
                    </h3>
                    <button
                      onClick={() => setShowNewFolderModal(false)}
                      className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-extrabold text-gray-600 uppercase tracking-wider mb-1.5">
                        Folder Name
                      </label>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="e.g. Medical Q&A, Customer Support, Edge Cases"
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateFolder(newFolderName, newFolderColor);
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-600 uppercase tracking-wider mb-2">
                        Folder Tag Color
                      </label>
                      <div className="flex gap-2.5">
                        {(['indigo', 'emerald', 'amber', 'rose', 'sky', 'purple', 'slate'] as const).map(color => {
                          const info = getFolderColorClasses(color);
                          return (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setNewFolderColor(color)}
                              className={`w-7 h-7 rounded-full ${info.dot} flex items-center justify-center transition-transform cursor-pointer ${
                                newFolderColor === color ? 'ring-2 ring-offset-2 ring-indigo-600 scale-110' : 'hover:scale-105'
                              }`}
                            >
                              {newFolderColor === color && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={() => setShowNewFolderModal(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => handleCreateFolder(newFolderName, newFolderColor)}
                      disabled={!newFolderName.trim()}
                      className="bg-indigo-650 hover:bg-indigo-700 text-white font-bold px-4 cursor-pointer"
                    >
                      Create Folder
                    </Button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {viewState === 'settings' && (
          <div className="animate-in fade-in duration-300">
            <CriteriaSettings 
              criteria={criteria} 
              onSave={setCriteria} 
              onReset={handleResetCriteria} 
            />
          </div>
        )}

        {viewState === 'editor' && currentConversation && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-12 animate-in slide-in-from-bottom-4 duration-500">
              
              {/* Left Column: Chat (Sticky on Desktop) */}
              <div className="lg:col-span-7 flex flex-col lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
                <div className="mb-4 flex flex-col gap-1.5 flex-shrink-0 animate-in fade-in duration-350">
                   <div className="flex justify-between items-center">
                      <h2 className="text-xl font-bold text-gray-800 truncate pr-4">{currentConversation.title}</h2>
                      <div className="flex gap-2 text-sm text-gray-500">
                        <span className="hidden sm:inline">Click message text to edit.</span>
                      </div>
                   </div>
                   <div className="flex items-center gap-2">
                     <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                       currentConversation.category === 'Normal'      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                       currentConversation.category === 'Edge Case'   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                       currentConversation.category === 'Multilingual'? 'bg-sky-50 text-sky-700 border-sky-100' :
                       currentConversation.category === 'Sensitive'   ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                                         'bg-slate-50 text-slate-600 border-slate-200'
                     }`}>
                       <div className="flex items-center gap-1.5 select-none py-0.5">
                         <span>Judge: {currentConversation.category || 'Uncategorized'}</span>
                         <span className="opacity-40">|</span>
                         <span className="text-[9px] uppercase tracking-wider opacity-95 text-xs">Correction:</span>
                         <select
                           value={currentConversation.category || 'Uncategorized'}
                           onChange={(e) => {
                             const newCat = e.target.value as ConversationCategory;
                             setConversations(prev => prev.map(c => c.id === currentConversation.id ? { ...c, category: newCat } : c));
                             setCurrentConversation(prev => prev ? { ...prev, category: newCat } : null);
                           }}
                           className="bg-transparent border-none text-[10px] font-bold text-current p-0 focus:ring-0 focus:outline-none cursor-pointer pr-1"
                         >
                           <option value="Uncategorized" className="text-gray-950 font-bold bg-white">Uncategorized</option>
                           <option value="Normal" className="text-gray-950 font-bold bg-white">Normal</option>
                           <option value="Edge Case" className="text-gray-950 font-bold bg-white">Edge Case</option>
                           <option value="Multilingual" className="text-gray-950 font-bold bg-white">Multilingual</option>
                           <option value="Sensitive" className="text-gray-950 font-bold bg-white">Sensitive</option>
                         </select>
                       </div>
                     </span>
                   </div>
                </div>
                {/* Chat wrapper to handle internal scroll for sticky behavior */}
                <div className="flex-1 min-h-0 overflow-hidden rounded-xl shadow-sm border border-gray-200 bg-white">
                  <ChatInterface 
                    messages={currentConversation.messages}
                    onUpdateMessage={handleMessageUpdate}
                    onAddComment={handleAddComment}
                    onDeleteComment={handleDeleteComment}
                  />
                </div>
              </div>

              {/* Right Column: Evaluation & Stats (Flow naturally) */}
              <div className="lg:col-span-5 space-y-6">
                    
                    {/* Action Card: Context & Config */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-semibold text-gray-900">Evaluation Config</h3>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-xs text-indigo-600"
                              onClick={() => setShowContextInputs(!showContextInputs)}
                            >
                              {showContextInputs ? 'Hide Context' : 'Show Context & Ground Truth'}
                            </Button>
                        </div>
                        
                        {showContextInputs && (
                          <div className="space-y-4 mb-6 animate-in fade-in slide-in-from-top-2">
                             <div>
                               <label className="block text-xs font-semibold text-gray-500 mb-1">Domain Context / Knowledge Base</label>
                               <textarea
                                 className="w-full text-sm p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                 rows={3}
                                 placeholder="Paste relevant dataset info or system instructions here..."
                                 value={currentConversation.domainContext || ''}
                                 onChange={(e) => handleUpdateContext('domainContext', e.target.value)}
                               />
                             </div>
                             <div>
                               <label className="block text-xs font-semibold text-gray-500 mb-1">Ground Truth / Reference Answer</label>
                               <textarea
                                 className="w-full text-sm p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                 rows={3}
                                 placeholder="What should the model have said? (Ideal Response)"
                                 value={currentConversation.referenceContext || ''}
                                 onChange={(e) => handleUpdateContext('referenceContext', e.target.value)}
                               />
                             </div>
                          </div>
                        )}

                        {/* Interactive LLM Judge Switch */}
                        <div className="mb-4">
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                            Active LLM Evaluation Judge
                          </label>
                          <div className="grid grid-cols-3 gap-1 bg-slate-50 p-1 rounded-lg border border-gray-200">
                            <button
                              type="button"
                              onClick={() => handleProviderChange('gemini')}
                              className={`py-2 px-3 rounded-md text-xs font-bold transition-all text-center ${
                                activeProvider === 'gemini'
                                  ? 'bg-indigo-600 text-white shadow-sm font-black'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                              }`}
                            >
                              Google Gemini
                            </button>
                            <button
                              type="button"
                              onClick={() => handleProviderChange('openai')}
                              className={`py-2 px-3 rounded-md text-xs font-bold transition-all text-center ${
                                activeProvider === 'openai'
                                  ? 'bg-indigo-600 text-white shadow-sm font-black'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                              }`}
                            >
                              OpenAI GPT
                            </button>
                            <button
                              type="button"
                              onClick={() => handleProviderChange('anthropic')}
                              className={`py-2 px-3 rounded-md text-xs font-bold transition-all text-center ${
                                activeProvider === 'anthropic'
                                  ? 'bg-indigo-600 text-white shadow-sm font-black'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                              }`}
                            >
                              Anthropic Claude
                            </button>
                          </div>
                          
                          {/* Key verification indicator for smooth user experience */}
                          {!hasProviderKey[activeProvider] && (
                            <div className="mt-2 text-xs bg-amber-50 text-amber-800 border border-amber-200 p-2.5 rounded-lg flex items-start gap-2.5 leading-normal animate-in fade-in slide-in-from-top-1">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-0.5 flex-shrink-0 text-amber-600"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                              <div>
                                <span className="font-bold">Missing Saved Key: </span>
                                You haven't stored an API key for <span className="capitalize">{activeProvider}</span> yet.
                                <button 
                                  onClick={() => setViewState('settings')}
                                  className="text-indigo-600 hover:underline font-bold ml-1 inline-block"
                                >
                                  Configure in Settings →
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Interactive LLM Temperature slider right in sidebar */}
                        <div className="mb-4 bg-slate-50 p-3 rounded-lg border border-gray-200">
                          <div className="flex justify-between items-center mb-1.5">
                            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                              Judge Temperature: <span className="font-extrabold text-indigo-700">{appTemperature.toFixed(1)}</span>
                            </label>
                            <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold px-1.5 py-0.5 rounded font-sans uppercase">
                              {appTemperature === 0 ? 'Deterministic' : appTemperature >= 0.7 ? 'Creative' : 'Balanced'}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 font-mono">0.0</span>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.1"
                              value={appTemperature}
                              onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
                              className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <span className="text-[10px] text-gray-400 font-mono">1.0</span>
                          </div>
                          <p className="mt-1.5 text-[10px] text-gray-500 leading-relaxed font-sans">
                            {appTemperature === 0 
                              ? "Recommended for consistent scoring." 
                              : "Higher values introduce scoring variance."}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                           <input 
                             type="checkbox" 
                             id="factCheck" 
                             checked={enableFactCheck} 
                             onChange={(e) => setEnableFactCheck(e.target.checked)}
                             className="h-4 w-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                           />
                           <label htmlFor="factCheck" className="text-sm text-gray-700 cursor-pointer select-none">
                              Enable <strong>Online Fact Checking</strong>
                              <span className="block text-xs text-gray-500 font-normal">
                                {activeProvider === 'gemini' 
                                  ? 'Verify claims against real-time web data using Google Search Grounding.'
                                  : "Verify claims against the model's internal knowledge base via self-check."}
                              </span>
                           </label>
                        </div>

                        <Button 
                          className="w-full" 
                          onClick={handleEvaluate} 
                          isLoading={isEvaluating}
                          disabled={isEvaluating}
                        >
                          {currentConversation.evaluation ? 'Re-Evaluate Conversation' : 'Run Evaluation'}
                        </Button>
                    </div>

                    {/* Results */}
                    {currentConversation.evaluation && (
                      <>
                        {/* Overall Score Card */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 relative overflow-hidden">
                           <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full blur-3xl -mr-16 -mt-16"></div>
                           <div className="relative z-10 flex items-center justify-between">
                             <div>
                               <div className="text-4xl font-bold text-gray-900 mb-1">{currentConversation.evaluation.overallScore}</div>
                               <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Overall Score</div>
                             </div>
                             <div className="h-24 w-24">
                                {/* Small Radar or Circle could go here, but using the main radar chart below */}
                             </div>
                           </div>
                           <div className="mt-4 pt-4 border-t border-gray-100">
                             <div className="flex justify-between items-center mb-2">
                                <h4 className="text-sm font-semibold text-gray-900">Executive Summary</h4>
                                <div className="flex bg-gray-50 border border-gray-200 p-0.5 rounded gap-0.5 text-[10px] select-none">
                                  <button
                                    type="button"
                                    onClick={() => handleExportConversation('json')}
                                    title="Export Evaluation as Raw JSON data file"
                                    className="px-2 py-0.5 font-bold text-gray-750 hover:bg-white rounded transition-colors"
                                  >
                                    JSON
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleExportConversation('txt')}
                                    title="Export Evaluation as Beautiful Plain Text Report"
                                    className="px-2 py-0.5 font-bold text-gray-750 hover:bg-white rounded transition-colors"
                                  >
                                    TXT
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleExportConversation('md')}
                                    title="Export Evaluation as Formatted Markdown File"
                                    className="px-2 py-0.5 font-bold text-gray-750 hover:bg-white rounded transition-colors"
                                  >
                                    MD
                                  </button>
                                </div>
                              </div>
                             <p className="text-sm text-gray-600 leading-relaxed">
                               {currentConversation.evaluation.summary}
                             </p>
                           </div>
                        </div>

                        {/* Fact Check Report Card */}
                        {currentConversation.evaluation.factCheckReport && (
                          <div className="bg-white p-6 rounded-xl shadow-sm border border-orange-100 relative">
                             <h4 className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-3">
                               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                               Fact Check Analysis
                             </h4>
                             <p className="text-sm text-gray-600 leading-relaxed mb-4">
                               {currentConversation.evaluation.factCheckReport}
                             </p>
                             {currentConversation.evaluation.factCheckSources && currentConversation.evaluation.factCheckSources.length > 0 && (
                               <div className="text-xs">
                                 <div className="font-semibold text-gray-500 mb-1">Sources:</div>
                                 <ul className="space-y-1">
                                    {currentConversation.evaluation.factCheckSources.map((src, i) => (
                                      <li key={i}>
                                        <a href={src.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                                          <span className="truncate max-w-[200px]">{src.title}</span>
                                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                        </a>
                                      </li>
                                    ))}
                                 </ul>
                               </div>
                             )}
                          </div>
                        )}

                        {/* Metrics Visualization */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                            <h4 className="text-sm font-semibold text-gray-900 mb-4">Metric Breakdown</h4>
                            <ScoreRadar metrics={currentConversation.evaluation.metrics} />
                            
                            <div className="mt-6 space-y-4">
                                {currentConversation.evaluation.metrics.map(metric => (
                                    <div key={metric.name}>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-sm font-medium text-gray-700">{metric.name}</span>
                                            <span className={`text-sm font-bold ${metric.score >= 8 ? 'text-green-600' : metric.score >= 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                {metric.score}/10
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                                            <div className={`h-2 rounded-full ${metric.score >= 8 ? 'bg-green-500' : metric.score >= 5 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${metric.score * 10}%` }}></div>
                                        </div>
                                        <p className="text-xs text-gray-500">{metric.reasoning}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Improvements */}
                        {currentConversation.evaluation.suggestedImprovements && (
                            <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-xl shadow-sm border border-indigo-100">
                                <h4 className="flex items-center gap-2 text-sm font-bold text-indigo-900 mb-3">
                                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                   Suggestions for Improvement
                                </h4>
                                <div className="text-sm text-indigo-800 leading-relaxed space-y-1">
                                    {(() => {
                                        const raw = currentConversation.evaluation.suggestedImprovements;
                                        let lines: string[] = [];
                                        if (Array.isArray(raw)) {
                                            lines = raw.map(item => String(item));
                                        } else if (typeof raw === 'string') {
                                            lines = raw.split('\n');
                                        } else if (raw) {
                                            lines = [String(raw)];
                                        }
                                        return lines.filter(l => l.trim()).map((line, idx) => {
                                            // Detect markdown bullets or dashes at start
                                            const isBullet = /^[\*\-•]\s?/.test(line.trim());
                                            // Clean text
                                            const content = line.replace(/^[\*\-•]\s*/, '').trim();
                                            
                                            return (
                                                <div key={idx} className={`flex gap-2 ${isBullet ? 'pl-1' : ''}`}>
                                                    {isBullet && (
                                                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0 opacity-70" />
                                                    )}
                                                    <span>{content}</span>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>
                        )}
                      </>
                    )}
              </div>

            </div>
        )}
      </main>

      {/* Confirmation Modal */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-150 select-none">
            <div className="flex items-center gap-3 text-red-600 font-bold text-lg">
              <div className="p-2.5 bg-red-100 text-red-600 rounded-xl flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </div>
              {confirmModal.title}
            </div>
            <p className="text-sm text-gray-600 font-medium leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmModal.onConfirm()}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-sm transition-colors cursor-pointer"
              >
                {confirmModal.confirmLabel || 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
