/** Final, deterministic cleanup of patient-facing text before a TTS provider. */
export function sanitizeForSpeech(value: string, languageCode: string): string {
  const hindi = languageCode.startsWith('hi');
  const websiteCue = hindi ? 'वेबसाइट की जानकारी स्क्रीन पर देखें' : 'See the website on screen';
  const emailCue = hindi ? 'ईमेल पता स्क्रीन पर देखें' : 'See the email address on screen';
  const cleaned = value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/giu, '$1')
    .replace(/https?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/giu, websiteCue)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, emailCue)
    .replace(/^(?:\s*[-*•▪◦]+\s+|\s*\d+[.)]\s+)/gmu, '')
    .replace(/\*\*|__|~~|`|^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(
      /\bEmpanelled\s+Health\s+Care\s+Providers?\s*\(\s*EHCPs?\s*\)/giu,
      hindi ? 'योजना से जुड़े अस्पताल' : 'approved hospitals',
    )
    .replace(
      /\s*\(\s*(?:EHCPs?|AB[\s-]*PM[\s-]*JAY|PM[\s-]*JAY|BIS|CSC|PMAMs?|SECC(?:\s*2011)?|[A-Za-z\s.,/&'-]{2,60})\s*\)/gu,
      '',
    )
    .replace(/\b(?:AB[\s-]*)?PM[\s-]?JAY\b/giu, hindi ? 'आयुष्मान भारत योजना' : 'Ayushman Bharat scheme')
    .replace(/\bEHCPs?\b/giu, hindi ? 'योजना से जुड़े अस्पताल' : 'approved hospital')
    .replace(/\bPMAMs?\b/gu, hindi ? 'आरोग्य मित्र' : 'Arogya Mitra')
    .replace(/\bCSC\b/gu, hindi ? 'कॉमन सर्विस सेंटर' : 'Common Service Centre')
    .replace(/\bHbA1c\b/giu, hindi ? 'एच बी ए वन सी' : 'H B A one C')
    .replace(/\s+([,.!?।॥;:])/gu, '$1')
    .replace(/([,.!?।॥;:]){2,}/gu, '$1')
    .replace(/[\t ]+/gu, ' ')
    .replace(/\s*\n\s*/gu, ' ')
    .trim();
  const sentences = cleaned.split(/(?<=[.!?।॥])\s+/u);
  return sentences.filter((sentence, index) => index === 0
    || sentence.trim().toLocaleLowerCase() !== sentences[index - 1].trim().toLocaleLowerCase()).join(' ').trim();
}
