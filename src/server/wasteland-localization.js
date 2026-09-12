'use strict';

function localizeLegacyWorldText(value = '') {
  let text = String(value || '');
  const replacements = [
    ['Old Klim Supply Caravan', 'Снабженческий караван Управы'],
    ['Old Klim Road Patrol', 'Дозор Управы'],
    ['Road Raider Band', 'Дорожная банда рейдеров'],
    ['Mutant Roamers', 'Бродячие супермутанты'],
    ['Old Klim Caravan Yard', 'Ключи'],
    ['Free Caravans', 'Лига Тракта'],
    ['Wasteland Wildlife', 'Дикие твари пустоши'],
    ['Neutral Wastelanders', 'Нейтральные жители пустоши'],
    ['Raider ambush', 'Засада рейдеров'],
    ['Raiders vs patrol', 'Рейдеры против патруля'],
    ['Raiders', 'Рейдеры'],
    ['Mutants', 'Супермутанты'],
    [' delivered supplies to ', ' доставил груз в '],
    [' loaded resources at ', ' загрузился в '],
    [' accumulated resources.', ': накоплены ресурсы.']
  ];
  replacements.forEach(([from, to]) => { text = text.split(from).join(to); });
  return text;
}

module.exports = {
  localizeLegacyWorldText
};
