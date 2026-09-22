// Shared catalogue for the room picker and server-side validation.
export const PHILOSOPHERS = [
  ['krishna', 'Krishna', 'krishn krishna'],
  ['buddha', 'Gautama Buddha', 'buddh siddhartha'],
  ['ashtavakra', 'Ashtavakra', 'asthabakra astavakra'],
  ['osho', 'Osho', 'rajneesh'],
  ['socrates', 'Socrates'],
  ['j-krishnamurti', 'J. Krishnamurti', 'jiddu krishnmurti krishnamurthy'],
  ['mahavira', 'Mahavira'], ['adi-shankara', 'Adi Shankara', 'shankaracharya'],
  ['patanjali', 'Patanjali'], ['nagarjuna', 'Nagarjuna'], ['chanakya', 'Chanakya', 'kautilya'],
  ['kabir', 'Kabir'], ['guru-nanak', 'Guru Nanak'], ['mirabai', 'Mirabai', 'meera bai'],
  ['ramanuja', 'Ramanuja'], ['vivekananda', 'Swami Vivekananda'], ['ramakrishna', 'Ramakrishna'],
  ['ramana-maharshi', 'Ramana Maharshi', 'raman maharishi'], ['sri-aurobindo', 'Sri Aurobindo'],
  ['tagore', 'Rabindranath Tagore'], ['ambedkar', 'B. R. Ambedkar', 'bhimrao babasaheb'],
  ['ug-krishnamurti', 'U. G. Krishnamurti', 'uppaluri gopala'],
  ['plato', 'Plato'], ['aristotle', 'Aristotle'], ['pythagoras', 'Pythagoras'],
  ['heraclitus', 'Heraclitus'], ['diogenes', 'Diogenes'], ['epicurus', 'Epicurus'],
  ['zeno', 'Zeno of Citium'], ['epictetus', 'Epictetus'], ['seneca', 'Seneca'],
  ['marcus-aurelius', 'Marcus Aurelius'], ['plotinus', 'Plotinus'],
  ['confucius', 'Confucius'], ['laozi', 'Laozi', 'lao tzu lao tse'], ['zhuangzi', 'Zhuangzi', 'chuang tzu'],
  ['mencius', 'Mencius'], ['mozi', 'Mozi'], ['xunzi', 'Xunzi'], ['dogen', 'Dōgen'],
  ['nishida-kitaro', 'Nishida Kitarō'], ['rumi', 'Rumi', 'jalaluddin'], ['al-farabi', 'Al-Farabi'],
  ['avicenna', 'Avicenna (Ibn Sina)'], ['al-ghazali', 'Al-Ghazali'],
  ['averroes', 'Averroes (Ibn Rushd)'], ['ibn-arabi', 'Ibn Arabi'], ['suhrawardi', 'Suhrawardi'],
  ['descartes', 'René Descartes'], ['spinoza', 'Baruch Spinoza'], ['locke', 'John Locke'],
  ['hume', 'David Hume'], ['rousseau', 'Jean-Jacques Rousseau'], ['kant', 'Immanuel Kant'],
  ['hegel', 'G. W. F. Hegel'], ['schopenhauer', 'Arthur Schopenhauer'], ['kierkegaard', 'Søren Kierkegaard'],
  ['marx', 'Karl Marx'], ['nietzsche', 'Friedrich Nietzsche'], ['mill', 'John Stuart Mill'],
  ['russell', 'Bertrand Russell'], ['wittgenstein', 'Ludwig Wittgenstein'], ['heidegger', 'Martin Heidegger'],
  ['sartre', 'Jean-Paul Sartre'], ['camus', 'Albert Camus'], ['beauvoir', 'Simone de Beauvoir'],
  ['arendt', 'Hannah Arendt'], ['weil', 'Simone Weil'], ['foucault', 'Michel Foucault'],
  ['lao-russell', 'Lao Russell'], ['james', 'William James'], ['dewey', 'John Dewey'],
  ['dubois', 'W. E. B. Du Bois'], ['fanon', 'Frantz Fanon'], ['watts', 'Alan Watts']
].map(([id, name, aliases = '']) => ({ id: `philosopher:${id}`, name, aliases }));

export const PHILOSOPHER_LABELS = Object.fromEntries(PHILOSOPHERS.map(p => [p.id, p.name]));
PHILOSOPHER_LABELS['philosopher:others'] = 'Others';
export const MAX_PHILOSOPHERS = 10;
export const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
