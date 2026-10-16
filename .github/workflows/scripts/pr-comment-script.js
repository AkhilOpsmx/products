const fs = require('fs');
const path = require('path');
const os = require('os');

async function createPRComment(github, context, secrets) {
  const findingsPath = path.join(os.homedir(), '.local', 'bin', 'ssd-scan-results', 'diff-scan-findings.json');
  
  console.log('Looking for findings file at:', findingsPath);
  
  if (fs.existsSync(findingsPath)) {
    try {
      const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
      const summary = findings.summary || {};
      const metadata = findings.metadata || {};
      const detailedIssues = findings.detailedIssues || {};
      
      const totalNewIssues = summary.totalNewIssues || 0;
      const totalExistingIssues = summary.totalExistingIssues || 0;
      
      const newIssuesBySeverity = summary.newIssuesBySeverity || {};
      const oldIssuesBySeverity = summary.oldIssuesBySeverity || {};
      
      const newIssuesText = Object.entries(newIssuesBySeverity)
        .filter(([_, count]) => count > 0)
        .map(([severity, count]) => severity + ': ' + count)
        .join(', ') || 'None';
      
      const existingIssuesText = Object.entries(oldIssuesBySeverity)
        .filter(([_, count]) => count > 0)
        .map(([severity, count]) => severity + ': ' + count)
        .join(', ') || 'None';
      
      const buildStatus = summary.buildStatus || 'UNKNOWN';
      const statusEmoji = buildStatus === 'PASSING' ? '✅' : 
                         buildStatus === 'FAILING' ? '❌' : '⚠️';
      
      const newIssues = detailedIssues.newIssues || [];
      const hasNewIssues = newIssues.length > 0;
      const existingIssues = detailedIssues.existingIssues || [];
      const hasExistingIssues = existingIssues.length > 0;
      
      // Build comment parts separately to avoid template literal issues
      let commentParts = [];
      commentParts.push('## 🔒 Security Scan Results - PR #' + context.issue.number);
      commentParts.push('');
      commentParts.push('**📊 Issue Overview:**');
      commentParts.push('- **New Issues:** ' + totalNewIssues);
      commentParts.push('- **Existing Issues:** ' + totalExistingIssues);
      commentParts.push('');
      commentParts.push('**🚨 New Issues by Severity:** ' + newIssuesText);
      
      if (metadata.interruptForOldIssues) {
        commentParts.push('**⚠️ Existing Issues by Severity:** ' + existingIssuesText);
      }
      
      commentParts.push('');
      commentParts.push('**Build Status:** ' + statusEmoji + ' **' + buildStatus + '**');
      commentParts.push('');
      commentParts.push('**📎 Detailed Results:**');
      commentParts.push('');
      commentParts.push('📋 [View Workflow Run](' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + ')');
      commentParts.push('');
      commentParts.push('📁 [Download Summary File](' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + '#artifacts) (`diff-scan-summary-pr-' + context.issue.number + '`)');
      commentParts.push('');
      commentParts.push('🌐 [Explore Findings in SSD Portal](' + secrets.SSD_UPLOAD_URL + '/ui/artifact-security/generated)');
      commentParts.push('');
      commentParts.push('---');
      
      // Enhanced logic to show either new issues or existing issues (when interrupt-for-old-issues is true)
      const shouldShowDetails = hasNewIssues || (metadata.interruptForOldIssues && hasExistingIssues);
      
      if (shouldShowDetails) {
        commentParts.push('<details>');
        
        if (hasNewIssues) {
          commentParts.push('<summary>🔍 View Top New Issues (Click to expand)</summary>');
          commentParts.push('');
          
          newIssues.slice(0, 5).forEach((issue, index) => {
            const severity = (issue.severity || 'unknown').toUpperCase();
            const tool = issue.datasourceTool || 'Unknown';
            const title = issue.alertTitle || 'No title available';
            commentParts.push('**' + (index + 1) + '.** **' + severity + '** | ' + tool);
            commentParts.push('   └── `' + title + '`');
            commentParts.push('');
          });
          
          if (newIssues.length > 5) {
            commentParts.push('_... and ' + (newIssues.length - 5) + ' more new issues. Download the summary file for complete details._');
          }
        } else if (metadata.interruptForOldIssues && hasExistingIssues) {
          commentParts.push('<summary>⚠️ View Top Existing Issues (Click to expand)</summary>');
          commentParts.push('');
          
          existingIssues.slice(0, 5).forEach((issue, index) => {
            const severity = (issue.severity || 'unknown').toUpperCase();
            const tool = issue.datasourceTool || 'Unknown';
            const title = issue.alertTitle || 'No title available';
            commentParts.push('**' + (index + 1) + '.** **' + severity + '** | ' + tool);
            commentParts.push('   └── `' + title + '`');
            commentParts.push('');
          });
          
          if (existingIssues.length > 5) {
            commentParts.push('_... and ' + (existingIssues.length - 5) + ' more existing issues. Download the summary file for complete details._');
          }
        }
        
        commentParts.push('</details>');
      } else {
        commentParts.push('**' + statusEmoji + ' No new security issues found!** Great job maintaining secure code.');
      }
      
      const comment = commentParts.join('\n');
      
      const { data: comments } = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
      });
      
      const existingComment = comments.find(comment => 
        comment.user.type === 'Bot' && comment.body.includes('🔒 Security Scan Results')
      );
      
      if (existingComment) {
        await github.rest.issues.updateComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: existingComment.id,
          body: comment
        });
        console.log('Updated existing PR comment');
      } else {
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.issue.number,
          body: comment
        });
        console.log('Created new PR comment');
      }
      
    } catch (error) {
      console.error('Error processing findings file:', error);
      
      // Fallback comment for JSON parsing errors
      const fallbackComment = '## 🔒 Security Scan Completed - PR #' + context.issue.number + '\n\n' +
        'The security scan has finished, but there was an issue processing the detailed results.\n\n' +
        '**📎 Results:**\n\n' +
        '📋 [View Workflow Run](' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + ')\n\n' +
        '📁 [Download Artifacts](' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + '#artifacts)\n\n' +
        '🌐 [Explore in SSD Portal](' + secrets.SSD_UPLOAD_URL + '/ui/artifact-security/generated)\n\n' +
        '_Error details: ' + error.message + '_';
      
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: fallbackComment
      });
    }
  } else {
    console.log('Diff scan findings file not found, creating simple comment');
    
    // Create a simple comment when no findings file exists
    const simpleComment = '## 🔒 Security Scan Completed - PR #' + context.issue.number + '\n\n' +
      'The security scan has finished running.\n\n' +
      '**📎 Results:**\n\n' +
      '📋 [View Workflow Run](' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + ')\n\n' +
      '📁 [Download Artifacts](' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + '#artifacts)\n\n' +
      '🌐 [Explore in SSD Portal](' + secrets.SSD_UPLOAD_URL + '/ui/artifact-security/generated)';
    
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: simpleComment
    });
  }
}

function showArtifactInfo(context, secrets) {
  const findingsPath = path.join(os.homedir(), '.local', 'bin', 'ssd-scan-results', 'diff-scan-findings.json');
  
  console.log('=================================================');
  console.log('🎯 DIFF SCAN SUMMARY ARTIFACT');
  console.log('=================================================');
  console.log('📁 Artifact Name: diff-scan-summary-pr-' + context.issue.number);
  console.log('📄 Contains: diff-scan-findings.json');
  console.log('');
  console.log('🔗 Download Links:');
  console.log('   • GitHub Artifact: ' + secrets.GITHUB_SERVER_URL + '/' + context.repo.owner + '/' + context.repo.repo + '/actions/runs/' + secrets.GITHUB_RUN_ID + '#artifacts');
  console.log('   • SSD Portal: ' + secrets.SSD_UPLOAD_URL + '/ui/artifact-security/generated');
  console.log('');
  
  if (fs.existsSync(findingsPath)) {
    console.log('✅ Summary file created successfully');
    
    try {
      const stats = fs.statSync(findingsPath);
      const fileSizeInBytes = stats.size;
      const fileSizeInKB = (fileSizeInBytes / 1024).toFixed(1);
      console.log('📊 File size: ' + fileSizeInKB + 'K');
      console.log('');
      console.log('📋 Metadata preview:');
      
      try {
        const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
        const metadata = findings.metadata || {};
        
        console.log('   • Timestamp: ' + (metadata.timestamp || 'N/A'));
        console.log('   • Current Branch: ' + (metadata.currentBranch || 'N/A'));
        console.log('   • Base Branch: ' + (metadata.baseBranch || 'N/A'));
        console.log('   • Interrupt Condition: ' + (metadata.interruptCondition || 'N/A'));
        console.log('   • Interrupt for Old Issues: ' + (metadata.interruptForOldIssues || false));
        
        const summary = findings.summary || {};
        console.log('   • Total New Issues: ' + (summary.totalNewIssues || 0));
        console.log('   • Total Existing Issues: ' + (summary.totalExistingIssues || 0));
        console.log('   • Build Status: ' + (summary.buildStatus || 'UNKNOWN'));
        
      } catch (parseError) {
        console.log('   Could not parse JSON metadata: ' + parseError.message);
      }
      
    } catch (statError) {
      console.log('   Could not get file stats: ' + statError.message);
    }
    
  } else {
    console.log('❌ Summary file not found');
  }
  
  console.log('=================================================');
}

module.exports = { createPRComment, showArtifactInfo };
