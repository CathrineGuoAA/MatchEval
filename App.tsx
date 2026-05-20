
import React, { useState, useEffect } from 'react';
import { Conversation, EvaluationResult, ViewState, Message, Role, Comment, Criteria } from './types';
import { evaluateConversation, generateSampleConversation, performFactCheck } from './services/geminiService';
import { ScoreRadar } from './components/ScoreRadar';
import { ChatInterface } from './components/ChatInterface';
import { CriteriaSettings } from './components/CriteriaSettings';
import { Button } from './components/Button';

// Mock storage keys
const STORAGE_KEY = 'evalai_conversations';
const CRITERIA_STORAGE_KEY = 'evalai_criteria';

const DEFAULT_CRITERIA: Criteria[] = [
  { id: 'c1', name: 'Relevance', description: "How well the response addresses the user’s question and context." },
  { id: 'c2', name: 'Trustworthiness', description: "How responsible and transparent the advice is about uncertainty, limits or sources." },
  { id: 'c3', name: 'Accuracy', description: "Whether verifiable facts, steps and figures are correct." },
  { id: 'c4', name: 'Understandable Language', description: "How concise, well-structured and easy to understand the wording is." },
  { id: 'c5', name: 'Completeness / Match', description: "Whether it covers the essential needs and gives a concrete next step (e.g., contact/location/time/materials, ≥2 elements)." }
];

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('dashboard');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [criteria, setCriteria] = useState<Criteria[]>(DEFAULT_CRITERIA);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Evaluation Options
  const [enableFactCheck, setEnableFactCheck] = useState(false);
  const [showContextInputs, setShowContextInputs] = useState(false);

  // Load data from local storage on mount
  useEffect(() => {
    const storedConv = localStorage.getItem(STORAGE_KEY);
    if (storedConv) {
      try {
        setConversations(JSON.parse(storedConv));
      } catch (e) {
        console.error("Failed to parse stored conversations", e);
      }
    }

    const storedCriteria = localStorage.getItem(CRITERIA_STORAGE_KEY);
    if (storedCriteria) {
      try {
        const parsed = JSON.parse(storedCriteria);
        // If it contains the old default values (like Helpfulness or Coherence), migrate to the new ones automatically
        const isOldDefault = Array.isArray(parsed) && parsed.some(c => c.name === 'Helpfulness' || c.name === 'Coherence');
        if (isOldDefault) {
          setCriteria(DEFAULT_CRITERIA);
          localStorage.setItem(CRITERIA_STORAGE_KEY, JSON.stringify(DEFAULT_CRITERIA));
        } else {
          setCriteria(parsed);
        }
      } catch (e) {
        console.error("Failed to parse stored criteria", e);
      }
    } else {
      localStorage.setItem(CRITERIA_STORAGE_KEY, JSON.stringify(DEFAULT_CRITERIA));
    }
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem(CRITERIA_STORAGE_KEY, JSON.stringify(criteria));
  }, [criteria]);

  const handleCreateNew = async () => {
    setIsEvaluating(true);
    try {
      const newConv = await generateSampleConversation();
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversation(newConv);
      setViewState('editor');
    } catch (e: any) {
      setError(e?.message || "Failed to generate sample conversation.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleDownload = () => {
    if (!currentConversation) return;

    const jsonString = JSON.stringify(currentConversation, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // Create a safe filename
    const safeTitle = currentConversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'conversation';
    link.href = url;
    link.download = `${safeTitle}_evaluated.json`;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        
        let newConv: Conversation;

        // 1. Support for importing the Full Conversation Export (with highlights, comments, evaluation)
        if (json.messages && Array.isArray(json.messages)) {
             newConv = {
                 ...json,
                 // Regenerate ID to avoid conflicts if importing the same file twice
                 id: `conv-${Date.now()}`, 
                 createdAt: json.createdAt || Date.now()
             };
        } 
        // 2. Support for Raw Message Array (legacy/external tools)
        else if (Array.isArray(json)) {
            newConv = {
              id: `conv-${Date.now()}`,
              title: file.name.replace('.json', '') || 'Uploaded Conversation',
              messages: json.map((m: any, idx: number) => ({
                id: `msg-${Date.now()}-${idx}`,
                role: m.role || Role.USER,
                content: m.content || "",
                comments: []
              })),
              createdAt: Date.now()
            };
        } else {
             throw new Error("Unknown format");
        }
        
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversation(newConv);
        setViewState('editor');
      } catch (err) {
        setError("Invalid JSON format. Expected a Conversation object or an Array of messages.");
      }
    };
    reader.readAsText(file);
    // Reset value so the same file can be selected again
    event.target.value = '';
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
    const newMessages = currentConversation.messages.map(m => 
      m.id === msgId ? { ...m, comments: [...m.comments, newComment] } : m
    );
    updateConversationState({ ...currentConversation, messages: newMessages });
  };

  const handleDeleteComment = (msgId: string, commentId: string) => {
    if (!currentConversation) return;
    const newMessages = currentConversation.messages.map(m => 
      m.id === msgId ? { ...m, comments: m.comments.filter(c => c.id !== commentId) } : m
    );
    updateConversationState({ ...currentConversation, messages: newMessages });
  };

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentConversation?.id === id) {
        setCurrentConversation(null);
        setViewState('dashboard');
    }
  }

  const handleResetCriteria = () => {
    if (window.confirm("Reset all evaluation metrics to default?")) {
      setCriteria(DEFAULT_CRITERIA);
    }
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
                 <Button variant="secondary" size="sm" onClick={handleDownload} title="Download JSON">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download
                 </Button>
                 <Button variant="ghost" size="sm" onClick={() => setViewState('dashboard')}>Back to Dashboard</Button>
               </>
             )}
             <div className="text-xs bg-slate-100 border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hidden sm:block font-bold select-none uppercase tracking-wide">
               Active Engine: {localStorage.getItem('evalai_provider') || 'Gemini'}
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
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
                <p className="text-gray-500 mt-1">Manage and evaluate your AI conversations.</p>
              </div>
              <div className="flex gap-3">
                 <label className="cursor-pointer inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 text-sm">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Upload JSON</span>
                    <input type="file" className="hidden" accept=".json" onChange={handleFileUpload} />
                 </label>
                 <Button onClick={handleCreateNew} isLoading={isEvaluating}>Generate Sample</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {conversations.length === 0 ? (
                <div className="col-span-full py-20 text-center bg-white rounded-2xl border-2 border-dashed border-gray-200">
                    <p className="text-gray-400 text-lg">No conversations found. Upload one or generate a sample.</p>
                </div>
              ) : (
                conversations.map(conv => (
                  <div 
                    key={conv.id} 
                    onClick={() => { setCurrentConversation(conv); setViewState('editor'); }}
                    className="group bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-all cursor-pointer relative"
                  >
                    <div className="flex justify-between items-start mb-4">
                       <h3 className="font-semibold text-lg text-gray-900 line-clamp-1">{conv.title}</h3>
                       <button onClick={(e) => deleteConversation(conv.id, e)} className="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                       </button>
                    </div>
                    
                    <div className="flex justify-between items-end">
                       <div className="text-sm text-gray-500">
                          {conv.messages.length} turns • {new Date(conv.createdAt).toLocaleDateString()}
                       </div>
                       {conv.evaluation ? (
                         <div className="text-right">
                           <div className="text-2xl font-bold text-indigo-600">{conv.evaluation.overallScore}<span className="text-sm text-gray-400 font-normal">/10</span></div>
                           <div className="text-xs text-gray-400">Score</div>
                         </div>
                       ) : (
                         <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                           Draft
                         </span>
                       )}
                    </div>
                  </div>
                ))
              )}
            </div>
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
                <div className="mb-4 flex justify-between items-center flex-shrink-0">
                   <h2 className="text-xl font-bold text-gray-800 truncate pr-4">{currentConversation.title}</h2>
                   <div className="flex gap-2 text-sm text-gray-500">
                     <span className="hidden sm:inline">Click message text to edit.</span>
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

                        <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                           <input 
                             type="checkbox" 
                             id="factCheck" 
                             checked={enableFactCheck} 
                             onChange={(e) => setEnableFactCheck(e.target.checked)}
                             className="h-4 w-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                           />
                           <label htmlFor="factCheck" className="text-sm text-gray-700 cursor-pointer select-none">
                              Enable <strong>Online Fact Checking</strong> via Google Search
                              <span className="block text-xs text-gray-500 font-normal">Verify claims against real-time web data.</span>
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
                             <h4 className="text-sm font-semibold text-gray-900 mb-2">Executive Summary</h4>
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
                                    {currentConversation.evaluation.suggestedImprovements.split('\n').filter(l => l.trim()).map((line, idx) => {
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
                                    })}
                                </div>
                            </div>
                        )}
                      </>
                    )}
              </div>

            </div>
        )}
      </main>
    </div>
  );
};

export default App;
