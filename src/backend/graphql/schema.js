const {
    GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLInt, GraphQLFloat,
    GraphQLBoolean, GraphQLList, GraphQLNonNull, GraphQLInputObjectType, GraphQLEnumType
} = require('graphql');
const { resolvers } = require('./resolvers');

// ─── Enum Types ───────────────────────────────────────────────────────────────

const AggregationEnum = new GraphQLEnumType({
    name: 'Aggregation',
    values: {
        SUM: { value: 'SUM' },
        COUNT: { value: 'COUNT' },
        AVG: { value: 'AVG' },
        MIN: { value: 'MIN' },
        MAX: { value: 'MAX' },
    }
});

// ─── Output Types ─────────────────────────────────────────────────────────────

const DashboardResultType = new GraphQLObjectType({
    name: 'DashboardResult',
    fields: {
        columns: { type: new GraphQLList(GraphQLString) },
        rows: { type: GraphQLString }, // JSON string representing array of row objects
        totalRows: { type: GraphQLInt },
    }
});

// ─── Input Types ──────────────────────────────────────────────────────────────

const FilterInput = new GraphQLInputObjectType({
    name: 'FilterInput',
    fields: {
        field: { type: new GraphQLNonNull(GraphQLString) },
        operator: { type: GraphQLString, defaultValue: 'eq' },
        // eq, neq, gt, lt, gte, lte, in, like, nlike, sw, nsw, ew, new,
        // between, nbetween, isnull, notnull, regex
        value:  { type: GraphQLString },            // main value (nullable for isnull/notnull)
        value2: { type: GraphQLString },            // second value (for between/nbetween)
        combine: { type: GraphQLString, defaultValue: 'AND' }, // AND/OR with previous condition on same field
    }
});

const FieldConfigInput = new GraphQLInputObjectType({
    name: 'FieldConfigInput',
    fields: {
        field: { type: new GraphQLNonNull(GraphQLString) },
        aggregation: { type: AggregationEnum },
    }
});

// ─── Root Query ───────────────────────────────────────────────────────────────

const RootQuery = new GraphQLObjectType({
    name: 'Query',
    fields: {
        // Main query for the dynamic pivot dashboard / chart
        dashboardData: {
            type: DashboardResultType,
            args: {
                source: { type: GraphQLString, defaultValue: '' },
                fields: { type: new GraphQLList(GraphQLString) },
                filters: { type: new GraphQLList(FilterInput) },
                groupBy: { type: new GraphQLList(GraphQLString) },
                values: { type: new GraphQLList(FieldConfigInput) },
                limit: { type: GraphQLInt },
                splitMultiValue: { type: GraphQLBoolean, defaultValue: true },
                topN: { type: GraphQLInt },
            },
            resolve: resolvers.dashboardData,
        },

        // Metadata of available fields for dynamic querying
        availableFields: {
            type: GraphQLString, // JSON string with fields metadata list
            args: {
                source: { type: GraphQLString, defaultValue: '' },
            },
            resolve: resolvers.availableFields,
        },
    }
});

const schema = new GraphQLSchema({
    query: RootQuery,
});

module.exports = { schema };
