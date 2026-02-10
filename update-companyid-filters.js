const fs = require('fs');
const path = require('path');

// 업데이트할 파일들
const files = [
  'src/components/RoomPerformanceDashboard.jsx',
  'src/components/OccupancyRateDashboard.jsx',
  'src/components/CountryOccupancyDashboard.jsx',
  'src/components/StatsAnalysis.jsx',
  'src/components/CustomerListDashboard.jsx',
  'src/components/BuildingCalendar.jsx',
  'src/components/SalesLogDashboard.jsx'
];

files.forEach(filePath => {
  const fullPath = path.join(__dirname, filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');

  // 1. Add useUser import if not exists
  if (!content.includes('useUser')) {
    content = content.replace(
      /import { db } from ['"]\.\.\/firebase['"]/,
      `import { db } from '../firebase';\nimport { useUser } from '../contexts/UserContext'`
    );
  }

  // 2. Add companyId destructuring in component
  // Find component definition
  const componentMatch = content.match(/(const|function)\s+\w+Dashboard/);
  if (componentMatch) {
    const afterComponent = content.indexOf('{', componentMatch.index);
    if (afterComponent > 0 && !content.substring(afterComponent, afterComponent + 200).includes('companyId')) {
      // Add companyId after opening brace
      const before = content.substring(0, afterComponent + 1);
      const after = content.substring(afterComponent + 1);
      content = before + '\n  const { companyId } = useUser();' + after;
    }
  }

  // 3. Add companyId filter to queries
  // Pattern: collection(db, "reservations")
  content = content.replace(
    /query\(\s*collection\(db,\s*["']reservations["']\),\s*where\(["']status["']/g,
    match => match.replace(
      /query\(\s*collection\(db,\s*["']reservations["']\),/,
      'query(collection(db, "reservations"),\n        where("companyId", "==", companyId),'
    )
  );

  //4. Add companyId check in fetch functions
  content = content.replace(
    /(const fetch\w+\s*=\s*async\s*\(\)\s*=>\s*{)/g,
    '$1\n    if (!companyId) {\n      console.warn(\'⚠️ No companyId for ' + path.basename(filePath, '.jsx') + '\');\n      setLoading(false);\n      return;\n    }\n'
  );

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✅ Updated: ${filePath}`);
});

console.log('\n✨ All files updated!');
