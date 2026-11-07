use super::*;

const DEFAULT_CONNECTOR: &str = "connector_76869538009648d5b282a4bb21c3d157";
const ENTERPRISE_TEMPLATE: &str = "templated_apps_GitHubEnterprise";

pub(super) fn repository_read(operation: &ServiceOperation) -> bool {
    matches!(
        operation,
        ServiceOperation::CloudGithubDefault
            | ServiceOperation::CloudGithubEnterprise
            | ServiceOperation::CloudGithubLinks
            | ServiceOperation::CloudGithubInstallations
            | ServiceOperation::CloudGithubRepositories
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connection {
    connector_id: String,
    link_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RepositoryPage {
    connector_id: String,
    link_id: Option<String>,
    page: u32,
    query: String,
    installation: Option<Installation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Installation {
    id: String,
    account_login: String,
    account_type: String,
}

fn invalid() -> ServiceError {
    failure(
        "invalid_request",
        "Invalid cloud GitHub discovery parameters",
    )
}

fn token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-~".contains(&b))
}

fn connection_valid(connector_id: &str, link_id: Option<&str>) -> bool {
    token(connector_id) && link_id.is_none_or(token)
}

pub(super) fn repository_route(
    operation: &ServiceOperation,
    params: &Value,
) -> ServiceResult<String> {
    let fixed = match operation {
        ServiceOperation::CloudGithubDefault => Some(format!("/backend-api/aip/connectors/{DEFAULT_CONNECTOR}?include_actions=false&apply_eligibility_filter=false")),
        ServiceOperation::CloudGithubEnterprise => Some(format!("/backend-api/ps/connectors/by-template?template_id={ENTERPRISE_TEMPLATE}")),
        ServiceOperation::CloudGithubLinks => Some("/backend-api/aip/connectors/links/list_accessible".to_owned()),
        _ => None,
    };
    if let Some(path) = fixed {
        return params
            .as_object()
            .filter(|object| object.is_empty())
            .map(|_| path)
            .ok_or_else(invalid);
    }

    let path;
    let (connector_id, link_id, page, query, installation) = match operation {
        ServiceOperation::CloudGithubInstallations => {
            let input: Connection =
                serde_json::from_value(params.clone()).map_err(|_| invalid())?;
            path = "/backend-api/wham/github/installations/v2".to_owned();
            (input.connector_id, input.link_id, None, String::new(), None)
        }
        ServiceOperation::CloudGithubRepositories => {
            let input: RepositoryPage =
                serde_json::from_value(params.clone()).map_err(|_| invalid())?;
            let query = input.query.trim().to_owned();
            if input.page == 0
                || query.len() > 512
                || query.chars().any(char::is_control)
                || input.installation.as_ref().is_some_and(|item| {
                    !token(&item.id) || !token(&item.account_login) || !token(&item.account_type)
                })
            {
                return Err(invalid());
            }
            path = match (query.is_empty(), input.installation.as_ref()) {
                (true, None) => "/backend-api/wham/github/list-repositories".to_owned(),
                (true, Some(item)) => {
                    format!("/backend-api/wham/github/repositories/v2/{}", item.id)
                }
                (false, None) => {
                    "/backend-api/wham/github/repositories/search/all-installations".to_owned()
                }
                (false, Some(_)) => "/backend-api/wham/github/repositories/search".to_owned(),
            };
            (
                input.connector_id,
                input.link_id,
                Some(input.page),
                query,
                input.installation,
            )
        }
        _ => return Err(invalid()),
    };
    if !connection_valid(&connector_id, link_id.as_deref()) {
        return Err(invalid());
    }
    let mut url =
        tauri::Url::parse(&format!("https://chatgpt.com{path}")).map_err(|_| invalid())?;
    let mut query_params = url.query_pairs_mut();
    query_params.append_pair("connector_id", &connector_id);
    if let Some(link) = link_id {
        query_params.append_pair("link_id", &link);
    }
    if let Some(page) = page {
        query_params.append_pair("page", &page.to_string());
        query_params.append_pair(
            if !query.is_empty() && installation.is_none() {
                "limit"
            } else {
                "per_page"
            },
            "20",
        );
    }
    if !query.is_empty() {
        query_params.append_pair("query", &query);
        if let Some(item) = installation {
            query_params.append_pair("account_login", &item.account_login);
            query_params.append_pair("account_type", &item.account_type);
        }
    }
    drop(query_params);
    Ok(format!(
        "{}?{}",
        url.path(),
        url.query().unwrap_or_default()
    ))
}

fn malformed() -> ServiceError {
    failure(
        "invalid_response",
        "Invalid cloud GitHub discovery response",
    )
}

fn text(value: &Value) -> ServiceResult<&str> {
    value
        .as_str()
        .filter(|text| !text.trim().is_empty() && !text.chars().any(char::is_control))
        .ok_or_else(malformed)
}

fn connector(value: &Value) -> ServiceResult<Value> {
    let id = text(&value["id"])?;
    if !token(id) {
        return Err(malformed());
    }
    if value["labels"]["admin_only_connector"].as_str() == Some("true") {
        return Ok(Value::Null);
    }
    Ok(
        json!({"id":id,"name":text(&value["name"])?,"disabled":value["status"] == "DISABLED_BY_ADMIN"}),
    )
}

pub(super) fn repository_body(operation: &ServiceOperation, body: &Value) -> ServiceResult<Value> {
    match operation {
        ServiceOperation::CloudGithubDefault => {
            if body["id"] != DEFAULT_CONNECTOR {
                return Err(malformed());
            }
            connector(body)
        }
        ServiceOperation::CloudGithubEnterprise => {
            let rows = body["connectors"].as_array().ok_or_else(malformed)?;
            let connectors = rows
                .iter()
                .filter(|row| row["template_id"] == ENTERPRISE_TEMPLATE)
                .map(connector)
                .collect::<ServiceResult<Vec<_>>>()?;
            Ok(
                json!({"connectors":connectors.into_iter().filter(|row| !row.is_null()).collect::<Vec<_>>()}),
            )
        }
        ServiceOperation::CloudGithubLinks => {
            let rows = body["links"].as_array().ok_or_else(malformed)?;
            let mut links = Vec::new();
            for row in rows {
                let id = text(&row["id"])?;
                if row["visibility"] == "HIDDEN" || id.starts_with("implicit_link::") {
                    continue;
                }
                let connector_id = text(&row["connector_id"])?;
                if !token(id) || !token(connector_id) {
                    continue;
                }
                links.push(json!({"id":id,"connector_id":connector_id,
                    "available":row["auth_status"] != "REAUTH_REQUIRED" && row["unavailable_reason"].is_null(),
                    "nickname":row["owner_profile"]["nickname"].as_str().map(str::trim).filter(|name| !name.is_empty())
                }));
            }
            Ok(json!({"links":links}))
        }
        ServiceOperation::CloudGithubInstallations => {
            let rows = |key: &str| -> ServiceResult<Vec<Value>> {
                body[key].as_array().ok_or_else(malformed)?.iter().map(|row| {
                    let id = row["id"].as_str().map(str::to_owned)
                        .or_else(|| row["id"].as_u64().map(|id| id.to_string())).filter(|id| token(id)).ok_or_else(malformed)?;
                    Ok(json!({"id":id,"account_login":text(&row["account_login"])?,"account_type":text(&row["account_type"])?}))
                }).collect()
            };
            Ok(json!({"memberships":rows("memberships")?,"other":rows("other")?}))
        }
        ServiceOperation::CloudGithubRepositories => {
            let rows = body["repositories"].as_array().ok_or_else(malformed)?;
            let repositories = rows.iter().map(|row| {
                Ok(json!({"id":text(&row["id"])?,"repository_full_name":text(&row["repository_full_name"])?,
                    "default_branch":row["default_branch"].as_str().filter(|branch| !branch.trim().is_empty() && !branch.chars().any(char::is_control))}))
            }).collect::<ServiceResult<Vec<_>>>()?;
            Ok(json!({"repositories":repositories}))
        }
        _ => Err(invalid()),
    }
}
