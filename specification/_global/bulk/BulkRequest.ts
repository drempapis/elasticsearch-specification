/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { RequestBase } from '@_types/Base'
import {
  Fields,
  IndexName,
  Refresh,
  Routing,
  WaitForActiveShards
} from '@_types/common'
import { Duration } from '@_types/Time'
import { SourceConfigParam } from '@global/search/_types/SourceFilter'
import { OperationContainer, UpdateAction } from './types'

/**
 * Bulk index or delete documents.
 * Perform multiple `index`, `create`, `delete`, and `update` actions in a single request.
 * This reduces overhead and can greatly increase indexing speed.
 *
 * If the Elasticsearch security features are enabled, you must have the following index privileges for the target data stream, index, or index alias:
 *
 * * To use the `create` action, you must have the `create_doc`, `create`, `index`, or `write` index privilege. Data streams support only the `create` action.
 * * To use the `index` action, you must have the `create`, `index`, or `write` index privilege.
 * * To use the `delete` action, you must have the `delete` or `write` index privilege.
 * * To use the `update` action, you must have the `index` or `write` index privilege.
 * * To automatically create a data stream or index with a bulk API request, you must have the `auto_configure`, `create_index`, or `manage` index privilege.
 * * To make the result of a bulk operation visible to search using the `refresh` parameter, you must have the `maintenance` or `manage` index privilege.
 *
 * Automatic data stream creation requires a matching index template with data stream enabled.
 *
 * The actions are specified in the request body using a newline delimited JSON (NDJSON) structure:
 *
 * ```
 * action_and_meta_data\n
 * optional_source\n
 * action_and_meta_data\n
 * optional_source\n
 * ....
 * action_and_meta_data\n
 * optional_source\n
 * ```
 *
 * The `index` and `create` actions expect a source on the next line and have the same semantics as the `op_type` parameter in the standard index API.
 * A `create` action fails if a document with the same ID already exists in the target
 * An `index` action adds or replaces a document as necessary.
 *
 * NOTE: Data streams support only the `create` action.
 * To update or delete a document in a data stream, you must target the backing index containing the document.
 *
 * An `update` action expects that the partial doc, upsert, and script and its options are specified on the next line.
 *
 * A `delete` action does not expect a source on the next line and has the same semantics as the standard delete API.
 *
 * NOTE: The final line of data must end with a newline character (`\n`).
 * Each newline character may be preceded by a carriage return (`\r`).
 * When sending NDJSON data to the `_bulk` endpoint, use a `Content-Type` header of `application/json` or `application/x-ndjson`.
 * Because this format uses literal newline characters (`\n`) as delimiters, make sure that the JSON actions and sources are not pretty printed.
 *
 * If you provide a target in the request path, it is used for any actions that don't explicitly specify an `_index` argument.
 *
 * A note on the format: the idea here is to make processing as fast as possible.
 * As some of the actions are redirected to other shards on other nodes, only `action_meta_data` is parsed on the receiving node side.
 *
 * Client libraries using this protocol should try and strive to do something similar on the client side, and reduce buffering as much as possible.
 *
 * There is no "correct" number of actions to perform in a single bulk request.
 * Experiment with different settings to find the optimal size for your particular workload.
 * Note that Elasticsearch limits the maximum size of a HTTP request to 100mb by default so clients must ensure that no request exceeds this size.
 * It is not possible to index a single document that exceeds the size limit, so you must pre-process any such documents into smaller pieces before sending them to Elasticsearch.
 * For instance, split documents into pages or chapters before indexing them, or store raw binary data in a system outside Elasticsearch and replace the raw data with a link to the external system in the documents that you send to Elasticsearch.
 *
 * **Client suppport for bulk requests**
 *
 * Some of the officially supported clients provide helpers to assist with bulk requests and reindexing:
 *
 * * Go: Check out `esutil.BulkIndexer`
 * * Perl: Check out `Search::Elasticsearch::Client::5_0::Bulk` and `Search::Elasticsearch::Client::5_0::Scroll`
 * * Python: Check out `elasticsearch.helpers.*`
 * * JavaScript: Check out `client.helpers.*`
 * * .NET: Check out `BulkAllObservable`
 * * PHP: Check out bulk indexing.
 *
 * **Submitting bulk requests with cURL**
 *
 * If you're providing text file input to `curl`, you must use the `--data-binary` flag instead of plain `-d`.
 * The latter doesn't preserve newlines. For example:
 *
 * ```
 * $ cat requests
 * { "index" : { "_index" : "test", "_id" : "1" } }
 * { "field1" : "value1" }
 * $ curl -s -H "Content-Type: application/x-ndjson" -XPOST localhost:9200/_bulk --data-binary "@requests"; echo
 * {"took":7, "errors": false, "items":[{"index":{"_index":"test","_id":"1","_version":1,"result":"created","forced_refresh":false}}]}
 * ```
 *
 * **Optimistic concurrency control**
 *
 * Each `index` and `delete` action within a bulk API call may include the `if_seq_no` and `if_primary_term` parameters in their respective action and meta data lines.
 * The `if_seq_no` and `if_primary_term` parameters control how operations are run, based on the last modification to existing documents. See Optimistic concurrency control for more details.
 *
 * **Versioning**
 *
 * Each bulk item can include the version value using the `version` field.
 * It automatically follows the behavior of the index or delete operation based on the `_version` mapping.
 * It also support the `version_type`.
 *
 * **Routing**
 *
 * Each bulk item can include the routing value using the `routing` field.
 * It automatically follows the behavior of the index or delete operation based on the `_routing` mapping.
 *
 * NOTE: Data streams do not support custom routing unless they were created with the `allow_custom_routing` setting enabled in the template.
 *
 * **Wait for active shards**
 *
 * When making bulk calls, you can set the `wait_for_active_shards` parameter to require a minimum number of shard copies to be active before starting to process the bulk request.
 *
 * **Refresh**
 *
 * Control when the changes made by this request are visible to search.
 *
 * NOTE: Only the shards that receive the bulk request will be affected by refresh.
 * Imagine a `_bulk?refresh=wait_for` request with three documents in it that happen to be routed to different shards in an index with five shards.
 * The request will only wait for those three shards to refresh.
 * The other two shards that make up the index do not participate in the `_bulk` request at all.
 *
 * You might want to disable the refresh interval temporarily to improve indexing throughput for large bulk requests.
 * Refer to the linked documentation for step-by-step instructions using the index settings API.
 * @rest_spec_name bulk
 * @availability stack stability=stable
 * @availability serverless stability=stable visibility=public
 * @doc_id docs-bulk
 * @ext_doc_id indices-refresh-disable
 * @doc_tag document
 *
 */
export interface Request<TDocument, TPartialDocument> extends RequestBase {
  urls: [
    {
      path: '/_bulk'
      methods: ['POST', 'PUT']
    },
    {
      path: '/{index}/_bulk'
      methods: ['POST', 'PUT']
    }
  ]
  path_parts: {
    /**
     * The name of the data stream, index, or index alias to perform bulk actions on.
     */
    index?: IndexName
  }
  query_parameters: {
    /**
     * True or false if to include the document source in the error message in case of parsing errors.
     * @server_default true
     */
    include_source_on_error?: boolean
    /**
     * If `true`, the response will include the ingest pipelines that were run for each index or create.
     * @server_default false
     */
    list_executed_pipelines?: boolean
    /**
     * The pipeline identifier to use to preprocess incoming documents.
     * If the index has a default ingest pipeline specified, setting the value to `_none` turns off the default ingest pipeline for this request.
     * If a final pipeline is configured, it will always run regardless of the value of this parameter.
     */
    pipeline?: string
    /**
     * If `true`, Elasticsearch refreshes the affected shards to make this operation visible to search.
     * If `wait_for`, wait for a refresh to make this operation visible to search.
     * If `false`, do nothing with refreshes.
     * Valid values: `true`, `false`, `wait_for`.
     * @server_default false
     */
    refresh?: Refresh
    /**
     * A custom value that is used to route operations to a specific shard.
     */
    routing?: Routing
    /**
     * Indicates whether to return the `_source` field (`true` or `false`) or contains a list of fields to return.
     */
    _source?: SourceConfigParam
    /**
     * A comma-separated list of source fields to exclude from the response.
     * You can also use this parameter to exclude fields from the subset specified in `_source_includes` query parameter.
     * If the `_source` parameter is `false`, this parameter is ignored.
     */
    _source_excludes?: Fields
    /**
     * A comma-separated list of source fields to include in the response.
     * If this parameter is specified, only these source fields are returned.
     * You can exclude fields from this subset using the `_source_excludes` query parameter.
     * If the `_source` parameter is `false`, this parameter is ignored.
     */
    _source_includes?: Fields
    /**
     * The period each action waits for the following operations: automatic index creation, dynamic mapping updates, and waiting for active shards.
     * The default is `1m` (one minute), which guarantees Elasticsearch waits for at least the timeout before failing.
     * The actual wait time could be longer, particularly when multiple waits occur.
     * @server_default 1m
     */
    timeout?: Duration
    /**
     * The number of shard copies that must be active before proceeding with the operation.
     * Set to `all` or any positive integer up to the total number of shards in the index (`number_of_replicas+1`).
     * The default is `1`, which waits for each primary shard to be active.
     * @server_default 1
     */
    wait_for_active_shards?: WaitForActiveShards
    /**
     * If `true`, the request's actions must target an index alias.
     * @server_default false
     */
    require_alias?: boolean
    /**
     * If `true`, the request's actions must target a data stream (existing or to be created).
     * @server_default false
     */
    require_data_stream?: boolean
  }
  /**
   * The request body contains a newline-delimited list of `create`, `delete`, `index`, and `update` actions and their associated source data.
   * @codegen_name operations */
  // This declaration captures action_and_meta_data (OperationContainer) and the two kinds of sources
  // that can follow: an update action for update operations and anything for index or create operations.
  // /!\ must be kept in sync with BulkMonitoringRequest
  body: Array<
    OperationContainer | UpdateAction<TDocument, TPartialDocument> | TDocument
  >
}
