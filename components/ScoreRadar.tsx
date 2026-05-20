import React from 'react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { Metric } from '../types';

interface ScoreRadarProps {
  metrics: Metric[];
}

export const ScoreRadar: React.FC<ScoreRadarProps> = ({ metrics }) => {
  // Normalize data for chart if needed, but metrics are usually sufficient
  const data = metrics.map(m => ({
    subject: m.name,
    A: m.score,
    fullMark: 10,
  }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid gridType="polygon" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#6B7280', fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
          <Radar
            name="Score"
            dataKey="A"
            stroke="#4F46E5"
            strokeWidth={2}
            fill="#6366F1"
            fillOpacity={0.4}
          />
          <Tooltip 
            formatter={(value: number) => [value, 'Score']}
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};