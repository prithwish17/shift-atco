# Security Documentation

## Overview

This document outlines the security measures implemented in ShiftPlan and best practices for maintaining security.

## Authentication & Authorization

### Supabase Auth
- Email/password authentication with secure password hashing
- Session management with automatic token refresh
- OTP-based password reset functionality

### Role-Based Access Control (RBAC)
- Four role levels: Admin, Supervisor, WSO, Employee
- Server-side authorization via Row-Level Security (RLS) policies
- Security definer functions: `has_role()`, `get_user_role()`
- Client-side role checks for UI/UX only (never for security decisions)

## Database Security

### Row-Level Security (RLS)
All tables have RLS enabled with policies enforcing:
- Users can only view their own data
- Supervisors/WSOs can view team data
- Admins have full access
- Proper approval workflows for role elevation

### Input Validation
**Client-Side:**
- Zod schema validation for all forms
- Type safety with TypeScript
- Length limits and format validation

**Server-Side:**
- Database CHECK constraints for data integrity
- Email format validation: `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`
- Employee ID format: `^[A-Z0-9]+$` (max 50 chars)
- Text field length limits enforced at database level
- Mobile number format validation

## Security Best Practices

### Password Security
- Minimum 8 characters
- Requires uppercase, lowercase, number, and special character
- Stored using bcrypt hashing via Supabase Auth
- Never logged or exposed in client code

### Error Handling
- Generic error messages to prevent information leakage
- Detailed errors logged server-side only
- No exposure of database constraint names or internal details
- Rate limiting on authentication endpoints

### API Security
- No direct SQL queries from client
- All queries use Supabase client with parameterized queries
- RLS policies enforce data access at database level
- JWT token verification for authenticated requests

### Secrets Management
- Admin credentials stored in environment variables
- Supabase secrets used for sensitive configuration
- No hardcoded credentials in source code
- Publishable keys safely used in client (designed for public exposure)

## Environment Variables

Required environment variables for deployment:

```
# Supabase Configuration (auto-configured)
VITE_SUPABASE_URL=<your-project-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>

# Edge Function Secrets (configure in Supabase dashboard)
ADMIN_EMAIL=<admin-email>
ADMIN_PASSWORD=<secure-password>
ADMIN_EMPLOYEE_ID=<admin-employee-id>
ADMIN_FULL_NAME=<admin-full-name>
```

## Security Checklist for Deployment

- [ ] Change default admin password immediately after setup
- [ ] Configure proper CORS settings in Supabase
- [ ] Enable leaked password protection in Supabase Auth
- [ ] Set up rate limiting for registration endpoints
- [ ] Configure email templates for auth flows
- [ ] Enable audit logging for sensitive operations
- [ ] Set up monitoring and alerts for security events
- [ ] Review and test all RLS policies
- [ ] Validate all input constraints are working
- [ ] Delete or secure the setup-admin edge function after initial setup
- [ ] Configure environment variables in production
- [ ] Set up SSL/TLS certificates
- [ ] Enable HTTPS only mode
- [ ] Configure Content Security Policy headers
- [ ] Set up automated security scanning

## Reporting Security Issues

If you discover a security vulnerability, please:
1. Do not open a public issue
2. Contact the security team directly
3. Provide detailed information about the vulnerability
4. Allow time for the issue to be addressed before disclosure

## Regular Security Maintenance

- Review access logs monthly
- Rotate admin credentials quarterly
- Update dependencies regularly
- Conduct security audits before major releases
- Review RLS policies when schema changes
- Monitor for suspicious authentication attempts
- Keep Supabase and dependencies up to date

## Compliance

ShiftPlan implements security controls appropriate for:
- Data protection and privacy requirements
- Industry-standard authentication practices
- Secure session management
- Audit trail maintenance for critical operations

## Additional Resources

- [Supabase Security Documentation](https://supabase.com/docs/guides/auth/auth-deep-dive/auth-deep-dive)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [React Security Best Practices](https://react.dev/learn/keeping-components-pure)
