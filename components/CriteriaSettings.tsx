
import React, { useState } from 'react';
import { Criteria } from '../types';
import { Button } from './Button';

interface CriteriaSettingsProps {
  criteria: Criteria[];
  onSave: (newCriteria: Criteria[]) => void;
  onReset: () => void;
}

export const CriteriaSettings: React.FC<CriteriaSettingsProps> = ({ criteria, onSave, onReset }) => {
  const [localCriteria, setLocalCriteria] = useState<Criteria[]>(criteria);
  const [newMetricName, setNewMetricName] = useState('');
  const [newMetricDesc, setNewMetricDesc] = useState('');

  // Sychronize local criteria state when props or default restoration happens
  React.useEffect(() => {
    setLocalCriteria(criteria);
  }, [criteria]);

  const handleAdd = () => {
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

  const handleDelete = (id: string) => {
    const newCriteria = localCriteria.filter(c => c.id !== id);
    setLocalCriteria(newCriteria);
    onSave(newCriteria);
  };

  const handleUpdate = (id: string, updates: Partial<Criteria>) => {
    const newCriteria = localCriteria.map(c => c.id === id ? { ...c, ...updates } : c);
    setLocalCriteria(newCriteria);
  };

  const handleBlurSave = () => {
      onSave(localCriteria);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-end border-b border-gray-200 pb-6">
        <div>
           <h2 className="text-2xl font-bold text-gray-900">Evaluation Criteria (G-Eval)</h2>
           <p className="text-gray-500 mt-2">Define the specific metrics and rubric descriptions the AI Judge should use to evaluate conversations.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { onReset(); setLocalCriteria([]); }}>
           Restore Defaults
        </Button>
      </div>

      <div className="space-y-6">
        {localCriteria.map((c) => (
          <div key={c.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm group hover:border-indigo-300 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <input
                type="text"
                value={c.name}
                onChange={(e) => handleUpdate(c.id, { name: e.target.value })}
                onBlur={handleBlurSave}
                className="font-bold text-lg text-gray-900 border-none focus:ring-0 p-0 hover:bg-gray-50 rounded w-full bg-transparent"
              />
              <button 
                onClick={() => handleDelete(c.id)}
                className="text-gray-400 hover:text-red-500 p-2"
                title="Remove Metric"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
            <textarea
              value={c.description}
              onChange={(e) => handleUpdate(c.id, { description: e.target.value })}
              onBlur={handleBlurSave}
              rows={2}
              className="w-full text-gray-600 text-sm border-gray-100 focus:border-indigo-300 focus:ring-indigo-100 rounded-lg bg-gray-50 p-3"
            />
          </div>
        ))}
      </div>

      <div className="bg-indigo-50 rounded-xl p-6 border border-indigo-100">
        <h3 className="font-semibold text-indigo-900 mb-4">Add New Metric</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          <div className="md:col-span-3">
            <input
              type="text"
              placeholder="Metric Name (e.g. Creativity)"
              value={newMetricName}
              onChange={(e) => setNewMetricName(e.target.value)}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="md:col-span-7">
            <input
              type="text"
              placeholder="Description / Rubric (e.g. Does the model provide novel and unexpected ideas?)"
              value={newMetricDesc}
              onChange={(e) => setNewMetricDesc(e.target.value)}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="md:col-span-2">
            <Button onClick={handleAdd} disabled={!newMetricName || !newMetricDesc} className="w-full">
              Add Metric
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
