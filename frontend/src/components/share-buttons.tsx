'use client';

import { useState } from 'react';
import { XLogo, Link, Check } from '@phosphor-icons/react';
import { toast } from 'sonner';

interface ShareButtonsProps {
  /** The URL to share */
  url: string;
  /** The text to include in social shares */
  text: string;
  /** Optional additional class names */
  className?: string;
}

/**
 * Share buttons component with Twitter/X share and copy link functionality
 */
export function ShareButtons({ url, text, className = '' }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handleTwitterShare = () => {
    const twitterUrl = new URL('https://twitter.com/intent/tweet');
    twitterUrl.searchParams.set('text', text);
    twitterUrl.searchParams.set('url', url);
    window.open(twitterUrl.toString(), '_blank', 'noopener,noreferrer,width=550,height=420');
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        toast.success('Link copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Failed to copy link');
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={handleTwitterShare}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/20 hover:bg-white/10 transition-colors"
        title="Share on Twitter/X"
      >
        <XLogo size={16} />
        <span className="text-sm">Share</span>
      </button>
      <button
        onClick={handleCopyLink}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
          copied
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/20 hover:bg-white/10'
        }`}
        title="Copy link"
      >
        {copied ? (
          <>
            <Check size={16} />
            <span className="text-sm">Copied</span>
          </>
        ) : (
          <>
            <Link size={16} />
            <span className="text-sm">Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Compact share buttons for smaller spaces
 */
export function ShareButtonsCompact({ url, text, className = '' }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handleTwitterShare = () => {
    const twitterUrl = new URL('https://twitter.com/intent/tweet');
    twitterUrl.searchParams.set('text', text);
    twitterUrl.searchParams.set('url', url);
    window.open(twitterUrl.toString(), '_blank', 'noopener,noreferrer,width=550,height=420');
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        onClick={handleTwitterShare}
        className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        title="Share on Twitter/X"
      >
        <XLogo size={16} />
      </button>
      <button
        onClick={handleCopyLink}
        className={`p-2 rounded-lg transition-colors ${
          copied
            ? 'text-emerald-400 bg-emerald-500/10'
            : 'text-white/40 hover:text-white hover:bg-white/10'
        }`}
        title="Copy link"
      >
        {copied ? <Check size={16} /> : <Link size={16} />}
      </button>
    </div>
  );
}
