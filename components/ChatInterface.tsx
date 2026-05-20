
import React, { useState, useRef, useEffect } from 'react';
import { Message, Role, Comment } from '../types';
import { Button } from './Button';

interface ChatInterfaceProps {
  messages: Message[];
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onAddComment: (messageId: string, text: string) => void;
  onDeleteComment: (messageId: string, commentId: string) => void;
  readOnly?: boolean;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onUpdateMessage,
  onAddComment,
  onDeleteComment,
  readOnly = false
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [commentInput, setCommentInput] = useState<{ id: string, text: string } | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (smooth = true) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  };

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length]);

  // Handle scroll visibility
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    }
  };

  const handleEditStart = (msg: Message) => {
    if (readOnly) return;
    setEditingId(msg.id);
    setEditContent(msg.content);
  };

  const handleEditSave = () => {
    if (editingId) {
      onUpdateMessage(editingId, { content: editContent });
      setEditingId(null);
    }
  };

  const toggleHighlight = (msg: Message, color: 'green' | 'red' | 'yellow' = 'yellow') => {
    if (readOnly) return;
    const isCurrentlyHighlighted = msg.isHighlighted && msg.highlightColor === color;
    onUpdateMessage(msg.id, {
      isHighlighted: !isCurrentlyHighlighted,
      highlightColor: !isCurrentlyHighlighted ? color : undefined
    });
  };

  const handleAddComment = (id: string) => {
    if (commentInput && commentInput.id === id && commentInput.text.trim()) {
      onAddComment(id, commentInput.text);
      setCommentInput(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div 
        className="flex-1 overflow-y-auto p-6 space-y-6" 
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {messages.map((msg) => (
          <div key={msg.id} className={`group flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] lg:max-w-[75%] flex flex-col ${msg.role === Role.USER ? 'items-end' : 'items-start'}`}>
              
              {/* Role Label */}
              <span className="text-xs text-gray-400 mb-1 ml-1 uppercase font-semibold tracking-wider">
                {msg.role}
              </span>

              {/* Message Bubble */}
              <div 
                className={`
                  relative p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap transition-all duration-200 border
                  ${msg.role === Role.USER 
                    ? 'bg-blue-50 text-blue-900 border-blue-100 rounded-tr-none' 
                    : 'bg-gray-50 text-gray-800 border-gray-100 rounded-tl-none'}
                  ${msg.isHighlighted && msg.highlightColor === 'yellow' ? 'ring-2 ring-yellow-400 bg-yellow-50' : ''}
                  ${msg.isHighlighted && msg.highlightColor === 'red' ? 'ring-2 ring-red-400 bg-red-50' : ''}
                  ${msg.isHighlighted && msg.highlightColor === 'green' ? 'ring-2 ring-green-400 bg-green-50' : ''}
                  hover:shadow-md
                `}
              >
                {editingId === msg.id ? (
                  <div className="min-w-[300px]">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 bg-white placeholder-gray-400 shadow-sm"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                      <Button size="sm" onClick={handleEditSave}>Save</Button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => !readOnly && handleEditStart(msg)} className={!readOnly ? "cursor-pointer" : ""}>
                     {msg.content}
                  </div>
                )}

                {/* Toolbar (visible on hover) */}
                {!readOnly && editingId !== msg.id && (
                  <div className="absolute -top-3 right-2 hidden group-hover:flex gap-1 bg-white shadow-sm rounded-full border border-gray-100 p-1 transform translate-y-[-50%] z-10">
                     <button title="Highlight Good" onClick={(e) => { e.stopPropagation(); toggleHighlight(msg, 'green'); }} className="w-5 h-5 rounded-full bg-green-100 hover:bg-green-200 text-green-600 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>
                    <button title="Highlight Warning" onClick={(e) => { e.stopPropagation(); toggleHighlight(msg, 'yellow'); }} className="w-5 h-5 rounded-full bg-yellow-100 hover:bg-yellow-200 text-yellow-600 flex items-center justify-center">
                       <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"></line></svg>
                    </button>
                     <button title="Highlight Bad" onClick={(e) => { e.stopPropagation(); toggleHighlight(msg, 'red'); }} className="w-5 h-5 rounded-full bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center">
                       <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                    <div className="w-px h-5 bg-gray-200 mx-0.5"></div>
                    <button title="Add Comment" onClick={(e) => { e.stopPropagation(); setCommentInput({ id: msg.id, text: '' }); }} className="p-0.5 text-gray-500 hover:text-blue-600">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                    <button title="Edit Text" onClick={(e) => { e.stopPropagation(); handleEditStart(msg); }} className="p-0.5 text-gray-500 hover:text-blue-600">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                  </div>
                )}
              </div>

              {/* Comments Section */}
              <div className="mt-2 w-full space-y-2">
                {msg.comments.map(comment => (
                  <div key={comment.id} className="bg-yellow-50 border border-yellow-100 p-2 rounded-lg text-xs text-gray-700 relative group/comment">
                    <span className="font-semibold text-yellow-800">Note:</span> {comment.text}
                    <button 
                      onClick={() => onDeleteComment(msg.id, comment.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover/comment:opacity-100 text-red-400 hover:text-red-600"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                ))}
                
                {/* Comment Input */}
                {commentInput && commentInput.id === msg.id && (
                  <div className="flex gap-2 items-center mt-2 animate-in fade-in slide-in-from-top-1">
                    <input 
                      type="text" 
                      className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                      placeholder="Add a note..."
                      value={commentInput.text}
                      onChange={(e) => setCommentInput({ ...commentInput, text: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddComment(msg.id)}
                      autoFocus
                    />
                    <Button size="sm" variant="primary" onClick={() => handleAddComment(msg.id)}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => setCommentInput(null)}>✕</Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Scroll to Bottom Button */}
      {showScrollButton && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-6 right-6 p-3 bg-white text-indigo-600 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 transition-all animate-in fade-in zoom-in duration-200 z-20"
          title="Scroll to Bottom"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
          </svg>
        </button>
      )}
    </div>
  );
};
