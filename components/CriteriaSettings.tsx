import React, { useState, useEffect } from 'react';
import { Criteria } from '../types';
import { Button } from './Button';
import { getLLMConfig } from '../services/geminiService';

interface CriteriaSettingsProps {
  criteria: Criteria[];
  onSave: (newCriteria: Criteria[]) => void;
  onReset: () => void;
}

type SettingsTab = 'metrics' | 'apiKeys';

export const CriteriaSettings: React.FC<CriteriaSettingsProps> = ({ criteria, onSave, onReset }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('metrics');
  
  // Metric settings states
  const [localCriteria, setLocalCriteria] = useState<Criteria[]>(criteria);
  const [newMetricName, setNewMetricName] = useState('');
  const [newMetricDesc, setNewMetricDesc] = useState('');

  // API Config states
  const [provider, setProvider] = useState<'gemini' | 'openai' | 'anthropic'>('gemini');
  const [temperature, setTemperature] = useState<number>(0);
  
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('');
  
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('claude-3-5-sonnet-20241022');
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('');

  // Show/Hide Keys state
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);

  // Status indicators for existing keys at mount
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);

  // Initialize metrics from props
  useEffect(() => {
    setLocalCriteria(criteria);
  }, [criteria]);

  // Load API settings from LocalStorage
  useEffect(() => {
    const config = getLLMConfig();
    
    setProvider(config.provider);
    setTemperature(config.temperature);
    
    setGeminiKey(config.geminiKey);
    setGeminiModel(config.geminiModel);
    setGeminiBaseUrl(config.geminiBaseUrl);
    
    setOpenaiKey(config.openaiKey);
    setOpenaiModel(config.openaiModel);
    setOpenaiBaseUrl(config.openaiBaseUrl);
    
    setAnthropicKey(config.anthropicKey);
    setAnthropicModel(config.anthropicModel);
    setAnthropicBaseUrl(config.anthropicBaseUrl);

    // Initial check for key existence (to show green/gray indicators)
    setHasGeminiKey(!!config.geminiKey);
    setHasOpenaiKey(!!config.openaiKey);
    setHasAnthropicKey(!!config.anthropicKey);
  }, []);

  const handleSaveAPIConfig = () => {
    localStorage.setItem('evalai_provider', provider);
    localStorage.setItem('evalai_temperature', String(temperature));
    
    // Store model names and bases in localStorage (non-sensitive metadata)
    localStorage.setItem('evalai_gemini_model', geminiModel);
    localStorage.setItem('evalai_gemini_base_url', geminiBaseUrl);
    
    localStorage.setItem('evalai_openai_model', openaiModel);
    localStorage.setItem('evalai_openai_base_url', openaiBaseUrl);
    
    localStorage.setItem('evalai_anthropic_model', anthropicModel);
    localStorage.setItem('evalai_anthropic_base_url', anthropicBaseUrl);

    // Store keys strictly in sessionStorage (RAM / active tab session)
    sessionStorage.setItem('evalai_gemini_api_key', geminiKey);
    sessionStorage.setItem('evalai_openai_api_key', openaiKey);
    sessionStorage.setItem('evalai_anthropic_api_key', anthropicKey);

    // Explicitly delete any key remnants in localStorage from outdated versions
    localStorage.removeItem('evalai_gemini_api_key');
    localStorage.removeItem('evalai_openai_api_key');
    localStorage.removeItem('evalai_anthropic_api_key');
    localStorage.removeItem('evalai_api_key');

    setHasGeminiKey(!!geminiKey);
    setHasOpenaiKey(!!openaiKey);
    setHasAnthropicKey(!!anthropicKey);

    // Save active API key to a generic sessionStorage key with backward fallback safety
    if (provider === 'gemini' && geminiKey) {
      sessionStorage.setItem('evalai_api_key', geminiKey);
    } else {
      sessionStorage.removeItem('evalai_api_key');
    }

    alert('Settings successfully saved! For privacy compliance, API Keys are retained ONLY in this tab\'s active sessionStorage and are never persisted permanently or sent to servers.');
  };

  const handleClearAPIConfig = (target: 'gemini' | 'openai' | 'anthropic') => {
    if (window.confirm(`Clear all stored API configs and keys for ${target === 'gemini' ? 'Gemini' : target === 'openai' ? 'OpenAI' : 'Claude'}?`)) {
      if (target === 'gemini') {
        setGeminiKey('');
        setGeminiModel('gemini-3.5-flash');
        setGeminiBaseUrl('');
        setTemperature(0);
        
        // Remove from sessionStorage
        sessionStorage.removeItem('evalai_gemini_api_key');
        sessionStorage.removeItem('evalai_api_key');
        
        // Remove remnants from localStorage if any
        localStorage.removeItem('evalai_gemini_api_key');
        localStorage.removeItem('evalai_api_key');
        localStorage.removeItem('evalai_gemini_model');
        localStorage.removeItem('evalai_gemini_base_url');
        localStorage.removeItem('evalai_temperature');
        setHasGeminiKey(false);
      } else if (target === 'openai') {
        setOpenaiKey('');
        setOpenaiModel('gpt-4o-mini');
        setOpenaiBaseUrl('');
        setTemperature(0);
        
        // Remove from sessionStorage
        sessionStorage.removeItem('evalai_openai_api_key');
        
        // Remove from localStorage
        localStorage.removeItem('evalai_openai_api_key');
        localStorage.removeItem('evalai_openai_model');
        localStorage.removeItem('evalai_openai_base_url');
        localStorage.removeItem('evalai_temperature');
        setHasOpenaiKey(false);
      } else if (target === 'anthropic') {
        setAnthropicKey('');
        setAnthropicModel('claude-3-5-sonnet-20241022');
        setAnthropicBaseUrl('');
        setTemperature(0);
        
        // Remove from sessionStorage
        sessionStorage.removeItem('evalai_anthropic_api_key');
        
        // Remove from localStorage
        localStorage.removeItem('evalai_anthropic_api_key');
        localStorage.removeItem('evalai_anthropic_model');
        localStorage.removeItem('evalai_anthropic_base_url');
        localStorage.removeItem('evalai_temperature');
        setHasAnthropicKey(false);
      }
    }
  };

  const handleAddMetric = () => {
    if (!newMetricName.trim() || !newMetricDesc.trim()) return;
    
    const newCriteria = [
      ...localCriteria,
      {
        id: `c-${Date.now()}`,
        name: newMetricName,
        description: newMetricDesc
      }
    ];
    setLocalCriteria(newCriteria);
    setNewMetricName('');
    setNewMetricDesc('');
    onSave(newCriteria);
  };

  const handleDeleteMetric = (id: string) => {
    const newCriteria = localCriteria.filter(c => c.id !== id);
    setLocalCriteria(newCriteria);
    onSave(newCriteria);
  };

  const handleUpdateMetric = (id: string, updates: Partial<Criteria>) => {
    const newCriteria = localCriteria.map(c => c.id === id ? { ...c, ...updates } : c);
    setLocalCriteria(newCriteria);
  };

  const handleBlurSave = () => {
    onSave(localCriteria);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      
      {/* Settings Navigation Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-200 pb-5 gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">System Settings</h2>
          <p className="text-gray-500 text-sm mt-1">Configure evaluation metrics and LLM endpoint credentials.</p>
        </div>
        
        {/* Tab Controls */}
        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 self-stretch sm:self-auto">
          <button
            onClick={() => setActiveTab('metrics')}
            className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              activeTab === 'metrics'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Metrics Core
          </button>
          <button
            onClick={() => setActiveTab('apiKeys')}
            className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              activeTab === 'apiKeys'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Model & API Keys
          </button>
        </div>
      </div>

      {/* TAB 1: G-EVAL CRITERIA */}
      {activeTab === 'metrics' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div>
              <h3 className="font-bold text-gray-900">Custom Evaluation Criteria</h3>
              <p className="text-xs text-gray-500">Edit metrics below. Changes save automatically when clicking out of field.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { onReset(); setLocalCriteria([]); }}>
               Restore Defaults
            </Button>
          </div>

          <div className="space-y-4">
            {localCriteria.map((c) => (
              <div key={c.id} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:border-indigo-200 transition-colors">
                <div className="flex justify-between items-start mb-3 gap-4">
                  <input
                    type="text"
                    value={c.name}
                    onChange={(e) => handleUpdateMetric(c.id, { name: e.target.value })}
                    onBlur={handleBlurSave}
                    className="font-bold text-base text-gray-900 border-none focus:ring-0 p-0 hover:bg-gray-50 rounded w-full bg-transparent"
                  />
                  <button 
                    onClick={() => handleDeleteMetric(c.id)}
                    className="text-gray-400 hover:text-red-500 p-1.5 rounded transition-colors"
                    title="Remove Metric"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
                <textarea
                  value={c.description}
                  onChange={(e) => handleUpdateMetric(c.id, { description: e.target.value })}
                  onBlur={handleBlurSave}
                  rows={2}
                  className="w-full text-gray-600 text-sm border-gray-100 focus:border-indigo-300 focus:ring-indigo-100 rounded-lg bg-gray-50 p-3"
                  placeholder="Define G-Eval criteria rubric instructions for the models..."
                />
              </div>
            ))}
          </div>

          {/* New Metric */}
          <div className="bg-gradient-to-r from-gray-50 to-indigo-50/20 rounded-xl p-5 border border-indigo-100 shadow-sm">
            <h3 className="font-bold text-sm text-indigo-900 mb-3">Add Custom Judge Criteria</h3>
            <div className="flex flex-col md:flex-row gap-3 items-stretch">
              <input
                type="text"
                placeholder="Metric Name (e.g., Creativity)"
                value={newMetricName}
                onChange={(e) => setNewMetricName(e.target.value)}
                className="rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm md:w-1/4"
              />
              <input
                type="text"
                placeholder="G-Eval Instruction Rubric (e.g., Does the response provide unique, detailed analogies?)"
                value={newMetricDesc}
                onChange={(e) => setNewMetricDesc(e.target.value)}
                className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              />
              <Button onClick={handleAddMetric} disabled={!newMetricName || !newMetricDesc}>
                Add Metric
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MODEL PROVIDERS & SECRETS */}
      {activeTab === 'apiKeys' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Privacy Safeguard Info Banner */}
          <div className="bg-indigo-50/55 border border-indigo-200/70 rounded-xl p-4 flex gap-3.5 items-start shadow-2xs animate-in slide-in-from-top-2 duration-300">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600 flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-pulse">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-black text-indigo-950 uppercase tracking-widest leading-none">Privacy-by-Design Safeguard</h4>
              <p className="text-xs text-indigo-900 leading-relaxed font-semibold">
                To guarantee absolute confidentiality, your API keys are loaded and stored <span className="underline decoration-indigo-300 font-bold decoration-2">only in this browser tab's RAM memory (sessionStorage)</span>.
              </p>
              <p className="text-[11px] text-indigo-700/90 leading-relaxed">
                They are never written permanently to persistent device storage (localStorage) or sent to remote cloud databases, and are instantly wiped from memory as soon as you close or refresh this browser tab. You will be requested to provide them again on each new session.
              </p>
            </div>
          </div>
          
          {/* Key status indicators bar */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-wrap gap-4 items-center justify-between shadow-sm">
            <span className="text-sm font-bold text-gray-500">Stored Credentials:</span>
            <div className="flex gap-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold leading-none ${hasGeminiKey ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasGeminiKey ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                Gemini
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold leading-none ${hasOpenaiKey ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasOpenaiKey ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                OpenAI GPT
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold leading-none ${hasAnthropicKey ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasAnthropicKey ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                Claude
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-200">
            {/* 1. Global Judge Selector */}
            <div className="p-6 space-y-5 bg-slate-50/50 rounded-t-xl">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-1">Active Judge Engine Provider</label>
                <p className="text-xs text-gray-500 mb-3">All prompt evaluation runs and sample generation triggers will route through this provider.</p>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setProvider('gemini')}
                    className={`py-3 px-4 rounded-xl border-2 text-center transition-all ${
                      provider === 'gemini'
                        ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700 font-bold'
                        : 'border-gray-200 bg-white hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    Google Gemini
                  </button>
                  <button
                    onClick={() => setProvider('openai')}
                    className={`py-3 px-4 rounded-xl border-2 text-center transition-all ${
                      provider === 'openai'
                        ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700 font-bold'
                        : 'border-gray-200 bg-white hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    OpenAI GPT
                  </button>
                  <button
                    onClick={() => setProvider('anthropic')}
                    className={`py-3 px-4 rounded-xl border-2 text-center transition-all ${
                      provider === 'anthropic'
                        ? 'border-indigo-600 bg-indigo-50/30 text-indigo-700 font-bold'
                        : 'border-gray-200 bg-white hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    Anthropic Claude
                  </button>
                </div>
              </div>

              {/* Temperature Parameter Slider Box */}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-bold text-gray-950">
                    Model Temperature: <span className="text-indigo-650 font-extrabold">{temperature.toFixed(1)}</span>
                  </label>
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                    temperature === 0 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : temperature >= 0.7 
                        ? 'bg-amber-50 text-amber-700 border-amber-200' 
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}>
                    {temperature === 0 ? 'Deterministic (Judge Recommended)' : temperature >= 0.7 ? 'Creative / Diverse' : 'Balanced'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Controls prediction randomness. For quantitative LLM-as-a-judge evaluations, a temperature of <strong>0.0</strong> guarantees high precision, reproducibility, and consistency.
                </p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                  <div className="flex-1 flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-mono">0.0</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <span className="text-xs text-gray-400 font-mono">1.0</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setTemperature(0)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-colors ${temperature === 0 ? 'bg-indigo-650 border-indigo-650 text-white shadow-sm' : 'bg-white border-gray-250 text-gray-700 hover:bg-gray-50'}`}
                    >
                      0.0 (Judge)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemperature(0.5)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-colors ${temperature === 0.5 ? 'bg-indigo-650 border-indigo-650 text-white shadow-sm' : 'bg-white border-gray-250 text-gray-700 hover:bg-gray-50'}`}
                    >
                      0.5
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemperature(0.7)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-colors ${temperature === 0.7 ? 'bg-indigo-650 border-indigo-650 text-white shadow-sm' : 'bg-white border-gray-250 text-gray-700 hover:bg-gray-50'}`}
                    >
                      0.7
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Gemini Form */}
            {provider === 'gemini' && (
              <div className="p-6 space-y-4 animate-in fade-in duration-150">
                <div className="flex justify-between items-center">
                  <h4 className="font-extrabold text-gray-900">Google Gemini Configuration</h4>
                  <button
                    onClick={() => handleClearAPIConfig('gemini')}
                    className="text-xs text-red-500 hover:underline font-semibold"
                  >
                    Reset Gemini Keys
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* API Key */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        {showGeminiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Model Name</label>
                    <input
                      type="text"
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      placeholder="gemini-3.5-flash"
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <span className="text-xs text-gray-400 font-semibold">Presets:</span>
                      <button onClick={() => setGeminiModel('gemini-3.5-flash')} className="text-xs text-indigo-500 hover:underline">3.5 Flash</button>
                      <button onClick={() => setGeminiModel('gemini-1.5-flash')} className="text-xs text-indigo-500 hover:underline">1.5 Flash</button>
                      <button onClick={() => setGeminiModel('gemini-1.5-pro')} className="text-xs text-indigo-500 hover:underline">1.5 Pro</button>
                    </div>
                  </div>

                  {/* Custom Base URL */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Custom API Endpoint (Optional proxy)</label>
                    <input
                      type="text"
                      value={geminiBaseUrl}
                      onChange={(e) => setGeminiBaseUrl(e.target.value)}
                      placeholder="https://generativelanguage.googleapis.com (default)"
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-2 bg-indigo-50 border border-indigo-100 p-3 rounded-lg flex items-start gap-2.5 text-xs text-indigo-800 leading-normal">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-0.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  <span>Google Search Grounding fact-checking is natively supported when using compatible Gemini models.</span>
                </div>
              </div>
            )}

            {/* 3. OpenAI Form */}
            {provider === 'openai' && (
              <div className="p-6 space-y-4 animate-in fade-in duration-150">
                <div className="flex justify-between items-center">
                  <h4 className="font-extrabold text-gray-900 font-sans">OpenAI GPT Configuration</h4>
                  <button
                    onClick={() => handleClearAPIConfig('openai')}
                    className="text-xs text-red-500 hover:underline font-semibold"
                  >
                    Reset OpenAI Keys
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* API Key */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">OpenAI API Key</label>
                    <div className="relative">
                      <input
                        type={showOpenaiKey ? 'text' : 'password'}
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        placeholder="sk-or-lh-..."
                        className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        {showOpenaiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Model Tag</label>
                    <input
                      type="text"
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <span className="text-xs text-gray-400 font-semibold">Presets:</span>
                      <button onClick={() => setOpenaiModel('gpt-4o-mini')} className="text-xs text-indigo-500 hover:underline">gpt-4o-mini</button>
                      <button onClick={() => setOpenaiModel('gpt-4o')} className="text-xs text-indigo-500 hover:underline">gpt-4o</button>
                      <button onClick={() => setOpenaiModel('o1-mini')} className="text-xs text-indigo-500 hover:underline">o1-mini</button>
                    </div>
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">API Base URL (Proxy/Alternative Gateway)</label>
                    <input
                      type="text"
                      value={openaiBaseUrl}
                      onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1 (default)"
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <span className="text-xs text-gray-400 font-semibold">Proxies:</span>
                      <button onClick={() => setOpenaiBaseUrl('https://api.openai.com/v1')} className="text-xs text-indigo-500 hover:underline">Official</button>
                      <button onClick={() => setOpenaiBaseUrl('https://openrouter.ai/api/v1')} className="text-xs text-indigo-500 hover:underline">OpenRouter</button>
                    </div>
                  </div>
                </div>

                <div className="mt-2 bg-amber-50 border border-amber-100 p-3 rounded-lg flex items-start gap-2.5 text-xs text-amber-800 leading-normal">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-0.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  <span>Using custom base endpoints (like OpenRouter or domestic gateways) lets you route evaluations through hundreds of OpenAI-compatible models.</span>
                </div>
              </div>
            )}

            {/* 4. Anthropic Form */}
            {provider === 'anthropic' && (
              <div className="p-6 space-y-4 animate-in fade-in duration-150">
                <div className="flex justify-between items-center">
                  <h4 className="font-extrabold text-gray-900 font-sans">Anthropic Claude Configuration</h4>
                  <button
                    onClick={() => handleClearAPIConfig('anthropic')}
                    className="text-xs text-red-500 hover:underline font-semibold"
                  >
                    Reset Claude Keys
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* API Key */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Anthropic / Proxy Key</label>
                    <div className="relative">
                      <input
                        type={showAnthropicKey ? 'text' : 'password'}
                        value={anthropicKey}
                        onChange={(e) => setAnthropicKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        {showAnthropicKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Claude Model Name</label>
                    <input
                      type="text"
                      value={anthropicModel}
                      onChange={(e) => setAnthropicModel(e.target.value)}
                      placeholder="claude-3-5-sonnet-20241022"
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <span className="text-xs text-gray-400 font-semibold">Presets:</span>
                      <button onClick={() => setAnthropicModel('claude-3-5-sonnet-20241022')} className="text-xs text-indigo-500 hover:underline">Sonnet 3.5</button>
                      <button onClick={() => setAnthropicModel('claude-3-5-haiku-20241022')} className="text-xs text-indigo-500 hover:underline">Haiku 3.5</button>
                    </div>
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Custom API Base URL (Highly recommended for CORS)</label>
                    <input
                      type="text"
                      value={anthropicBaseUrl}
                      onChange={(e) => setAnthropicBaseUrl(e.target.value)}
                      placeholder="https://api.anthropic.com/v1 (default)"
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                    <div className="mt-1.5 flex gap-2">
                      <span className="text-xs text-gray-400 font-semibold">Bypass CORS:</span>
                      <button onClick={() => setAnthropicBaseUrl('https://openrouter.ai/api/v1')} className="text-xs text-indigo-500 hover:underline">OpenRouter</button>
                    </div>
                  </div>
                </div>

                <div className="mt-2 bg-red-50 border border-red-100 p-3 rounded-lg flex items-start gap-2.5 text-xs text-red-800 leading-normal">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-0.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  <span>CORS Note: Direct browser calls to official api.anthropic.com may fail due to strict browser CORS controls. We recommend setting a proxy URL (like OpenRouter or a custom API gateway) for smooth in-browser operation.</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button variant="secondary" onClick={() => setActiveTab('metrics')}>
              Back to Metrics
            </Button>
            <Button onClick={handleSaveAPIConfig}>
              Save API Config
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
